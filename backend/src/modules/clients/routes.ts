import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  clientInputSchema,
  listClientsQuerySchema,
  updateClientSchema,
  type ClientDto,
  type Paginated,
} from '@duenudge/shared';
import { withTenant } from '../../db/tx.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { assertWithinLimit } from '../usage/service.js';

const idParam = z.object({ id: z.uuid() });

/** One query for the list & detail: client + money aggregates. Aggregates use a lateral subquery, not N+1. */
const CLIENT_SELECT = `
  c.id, c.name, c.email, c.company, c.phone, c.address, c.notes, c.payment_terms_days AS "paymentTermsDays",
  c.archived_at AS "archivedAt", c.created_at AS "createdAt",
  COALESCE(s.outstanding, 0)::bigint AS "outstandingCents", COALESCE(s.overdue, 0)::bigint AS "overdueCents",
  COALESCE(s.invoice_count, 0)::int AS "invoiceCount", s.avg_days_to_pay AS "avgDaysToPay"
  FROM clients c
  LEFT JOIN LATERAL (
    SELECT
      sum(CASE WHEN i.status IN ('sent','viewed','overdue') THEN i.total_cents - i.amount_paid_cents ELSE 0 END) AS outstanding,
      sum(CASE WHEN i.status = 'overdue' THEN i.total_cents - i.amount_paid_cents ELSE 0 END) AS overdue,
      count(*) FILTER (WHERE i.status <> 'void') AS invoice_count,
      round(avg(i.paid_at::date - i.issue_date) FILTER (WHERE i.status = 'paid'))::int AS avg_days_to_pay
    FROM invoices i WHERE i.client_id = c.id
  ) s ON true`;

export const clientRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    { schema: { querystring: listClientsQuerySchema, tags: ['clients'] } },
    async (req): Promise<Paginated<ClientDto>> => {
      const q = req.query as z.infer<typeof listClientsQuerySchema>;
      const auth = req.auth!;
      return withTenant(auth.tenantId, async (tx) => {
        const where: string[] = [];
        const params: unknown[] = [];
        if (!q.includeArchived) where.push('c.archived_at IS NULL');
        if (q.q) {
          params.push(`%${q.q}%`);
          where.push(
            `(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.company ILIKE $${params.length})`,
          );
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { count } = await tx.one<{ count: number }>(
          `SELECT count(*)::int AS count FROM clients c ${whereSql}`,
          params,
        );
        params.push(q.pageSize, (q.page - 1) * q.pageSize);
        const items = await tx.query<ClientDto>(
          `SELECT ${CLIENT_SELECT} ${whereSql} ORDER BY c.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        return { items, page: q.page, pageSize: q.pageSize, total: count ?? 0 };
      });
    },
  );

  app.get(
    '/:id',
    { schema: { params: idParam, tags: ['clients'] } },
    async (req): Promise<ClientDto> => {
      const { id } = req.params as { id: string };
      return withTenant(req.auth!.tenantId, (tx) =>
        tx.one<ClientDto>(`SELECT ${CLIENT_SELECT} WHERE c.id = $1`, [id], 'Client'),
      );
    },
  );

  app.post('/', { schema: { body: clientInputSchema, tags: ['clients'] } }, async (req, reply) => {
    const body = req.body as z.infer<typeof clientInputSchema>;
    const auth = req.auth!;
    const client = await withTenant(auth.tenantId, async (tx) => {
      await assertWithinLimit(tx, auth.tenantId, 'clients');
      const dup = await tx.maybeOne(`SELECT 1 FROM clients WHERE email = $1`, [body.email]);
      if (dup) throw conflict('A client with this email already exists', 'CLIENT_EMAIL_TAKEN');
      const tenant = await tx.one<{ default_payment_terms_days: number }>(
        `SELECT default_payment_terms_days FROM tenants WHERE id = $1`,
        [auth.tenantId],
      );
      const row = await tx.one<{ id: string }>(
        `INSERT INTO clients (tenant_id, name, email, company, phone, address, notes, payment_terms_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          auth.tenantId,
          body.name,
          body.email,
          body.company ?? null,
          body.phone ?? null,
          body.address ?? null,
          body.notes ?? null,
          body.paymentTermsDays ?? tenant.default_payment_terms_days,
        ],
      );
      await audit(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'client.created',
        entityType: 'client',
        entityId: row.id,
        metadata: { name: body.name },
        ip: req.ip,
      });
      return tx.one<ClientDto>(`SELECT ${CLIENT_SELECT} WHERE c.id = $1`, [row.id]);
    });
    return reply.status(201).send(client);
  });

  app.patch(
    '/:id',
    { schema: { params: idParam, body: updateClientSchema, tags: ['clients'] } },
    async (req): Promise<ClientDto> => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof updateClientSchema>;
      const auth = req.auth!;
      const cols: Record<string, string> = {
        name: 'name',
        email: 'email',
        company: 'company',
        phone: 'phone',
        address: 'address',
        notes: 'notes',
        paymentTermsDays: 'payment_terms_days',
      };
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [k, col] of Object.entries(cols)) {
        if (k in body) {
          params.push((body as Record<string, unknown>)[k]);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if (!sets.length) throw badRequest('Nothing to update');
      params.push(id);
      return withTenant(auth.tenantId, async (tx) => {
        const n = await tx.execute(
          `UPDATE clients SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params,
        );
        if (!n) throw notFound('Client');
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'client.updated',
          entityType: 'client',
          entityId: id,
          metadata: { fields: Object.keys(body) },
          ip: req.ip,
        });
        return tx.one<ClientDto>(`SELECT ${CLIENT_SELECT} WHERE c.id = $1`, [id]);
      });
    },
  );

  /** Archive (soft delete). Invoices keep their history. */
  app.delete('/:id', { schema: { params: idParam, tags: ['clients'] } }, async (req) => {
    const { id } = req.params as { id: string };
    const auth = req.auth!;
    await withTenant(auth.tenantId, async (tx) => {
      const open = await tx.maybeOne(
        `SELECT 1 FROM invoices WHERE client_id = $1 AND status IN ('sent','viewed','overdue')`,
        [id],
      );
      if (open)
        throw conflict(
          'This client has open invoices. Mark them paid or void first.',
          'CLIENT_HAS_OPEN_INVOICES',
        );
      const n = await tx.execute(
        `UPDATE clients SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
        [id],
      );
      if (!n) throw notFound('Client');
      await audit(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'client.archived',
        entityType: 'client',
        entityId: id,
        ip: req.ip,
      });
    });
    return { ok: true };
  });
};
