import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  invoiceInputSchema,
  listInvoicesQuerySchema,
  recordPaymentSchema,
  type InvoiceDto,
  type InvoiceSummaryDto,
  type Paginated,
} from '@duenudge/shared';
import { withTenant } from '../../db/tx.js';
import { randomToken } from '../../lib/crypto.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { todayIso } from '../../lib/dates.js';
import { enqueueEmail } from '../../email/service.js';
import { invoiceSentEmail } from '../../email/templates.js';
import { audit } from '../audit/service.js';
import { assertWithinLimit } from '../usage/service.js';
import { scheduleRemindersForInvoice, skipPendingReminders } from '../reminders/scheduling.js';
import {
  INVOICE_SUMMARY_SELECT,
  loadInvoiceDto,
  lockInvoice,
  nextInvoiceNumber,
  publicInvoiceUrl,
  replaceItems,
} from './service.js';

const idParam = z.object({ id: z.uuid() });

export const invoiceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    { schema: { querystring: listInvoicesQuerySchema, tags: ['invoices'] } },
    async (req): Promise<Paginated<InvoiceSummaryDto>> => {
      const q = req.query as z.infer<typeof listInvoicesQuerySchema>;
      const auth = req.auth!;
      return withTenant(auth.tenantId, async (tx) => {
        const where: string[] = [];
        const params: unknown[] = [];
        if (q.status) {
          params.push(q.status);
          where.push(`i.status = $${params.length}`);
        }
        if (q.clientId) {
          params.push(q.clientId);
          where.push(`i.client_id = $${params.length}`);
        }
        if (q.q) {
          params.push(`%${q.q}%`);
          where.push(`(i.number ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { count } = await tx.one<{ count: number }>(
          `SELECT count(*)::int AS count FROM invoices i JOIN clients c ON c.id = i.client_id ${whereSql}`,
          params,
        );
        params.push(q.pageSize, (q.page - 1) * q.pageSize);
        const items = await tx.query<InvoiceSummaryDto>(
          `SELECT ${INVOICE_SUMMARY_SELECT} FROM invoices i JOIN clients c ON c.id = i.client_id ${whereSql}
         ORDER BY i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        return { items, page: q.page, pageSize: q.pageSize, total: count ?? 0 };
      });
    },
  );

  app.get(
    '/:id',
    { schema: { params: idParam, tags: ['invoices'] } },
    async (req): Promise<InvoiceDto> => {
      const { id } = req.params as { id: string };
      return withTenant(req.auth!.tenantId, (tx) => loadInvoiceDto(tx, id));
    },
  );

  app.post(
    '/',
    { schema: { body: invoiceInputSchema, tags: ['invoices'] } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof invoiceInputSchema>;
      const auth = req.auth!;
      const dto = await withTenant(auth.tenantId, async (tx) => {
        const client = await tx.maybeOne<{ id: string; archived_at: string | null }>(
          `SELECT id, archived_at FROM clients WHERE id = $1`,
          [body.clientId],
        );
        if (!client) throw notFound('Client');
        if (client.archived_at) throw unprocessable('This client is archived', 'CLIENT_ARCHIVED');
        await assertWithinLimit(tx, auth.tenantId, 'invoices');
        const tenant = await tx.one<{ currency: string }>(
          `SELECT currency FROM tenants WHERE id = $1`,
          [auth.tenantId],
        );
        const number = await nextInvoiceNumber(tx, auth.tenantId);
        const row = await tx.one<{ id: string }>(
          `INSERT INTO invoices (tenant_id, client_id, number, currency, issue_date, due_date, notes, payment_link, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            auth.tenantId,
            body.clientId,
            number,
            body.currency ?? tenant.currency,
            body.issueDate,
            body.dueDate,
            body.notes ?? null,
            body.paymentLink ?? null,
            auth.userId,
          ],
        );
        const totals = await replaceItems(tx, auth.tenantId, row.id, body.items, body.taxRateBps);
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'invoice.created',
          entityType: 'invoice',
          entityId: row.id,
          metadata: { number, totalCents: totals.totalCents },
          ip: req.ip,
        });
        return loadInvoiceDto(tx, row.id);
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/:id',
    { schema: { params: idParam, body: invoiceInputSchema, tags: ['invoices'] } },
    async (req): Promise<InvoiceDto> => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof invoiceInputSchema>;
      const auth = req.auth!;
      return withTenant(auth.tenantId, async (tx) => {
        const inv = await lockInvoice(tx, id);
        if (inv.status !== 'draft')
          throw conflict('Only draft invoices can be edited', 'INVOICE_NOT_DRAFT');
        await tx.execute(
          `UPDATE invoices SET client_id = $2, currency = $3, issue_date = $4, due_date = $5, notes = $6, payment_link = $7 WHERE id = $1`,
          [
            id,
            body.clientId,
            body.currency ?? inv.currency,
            body.issueDate,
            body.dueDate,
            body.notes ?? null,
            body.paymentLink ?? null,
          ],
        );
        await replaceItems(tx, auth.tenantId, id, body.items, body.taxRateBps);
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'invoice.updated',
          entityType: 'invoice',
          entityId: id,
          ip: req.ip,
        });
        return loadInvoiceDto(tx, id);
      });
    },
  );

  app.delete('/:id', { schema: { params: idParam, tags: ['invoices'] } }, async (req) => {
    const { id } = req.params as { id: string };
    const auth = req.auth!;
    await withTenant(auth.tenantId, async (tx) => {
      const inv = await lockInvoice(tx, id);
      if (inv.status !== 'draft')
        throw conflict('Only draft invoices can be deleted. Void it instead.', 'INVOICE_NOT_DRAFT');
      await tx.execute(`DELETE FROM invoices WHERE id = $1`, [id]);
      await audit(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'invoice.deleted',
        entityType: 'invoice',
        entityId: id,
        metadata: { number: inv.number },
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  /** draft -> sent: emails the client, creates the public link, schedules reminders. */
  app.post(
    '/:id/send',
    { schema: { params: idParam, tags: ['invoices'] } },
    async (req): Promise<InvoiceDto> => {
      const { id } = req.params as { id: string };
      const auth = req.auth!;
      return withTenant(auth.tenantId, async (tx) => {
        const inv = await lockInvoice(tx, id);
        if (inv.status !== 'draft')
          throw conflict('Invoice has already been sent', 'INVOICE_ALREADY_SENT');
        if (inv.total_cents <= 0)
          throw unprocessable('Invoice total must be greater than zero', 'INVOICE_EMPTY');
        const token = inv.public_token ?? randomToken(24);
        await tx.execute(
          `UPDATE invoices SET status = 'sent', sent_at = now(), public_token = $2 WHERE id = $1`,
          [id, token],
        );
        const client = await tx.one<{ name: string; email: string }>(
          `SELECT name, email FROM clients WHERE id = $1`,
          [inv.client_id],
        );
        const tenant = await tx.one<{ name: string; reminder_offsets: number[]; timezone: string }>(
          `SELECT name, reminder_offsets, timezone FROM tenants WHERE id = $1`,
          [auth.tenantId],
        );
        await enqueueEmail(tx, {
          tenantId: auth.tenantId,
          to: client.email,
          template: 'invoice-sent',
          invoiceId: id,
          ...invoiceSentEmail({
            businessName: tenant.name,
            clientName: client.name,
            number: inv.number,
            totalCents: inv.total_cents,
            currency: inv.currency,
            dueDate: inv.due_date,
            publicUrl: publicInvoiceUrl(token)!,
            paymentLink: inv.payment_link,
          }),
        });
        const scheduled = await scheduleRemindersForInvoice(tx, inv, tenant);
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'invoice.sent',
          entityType: 'invoice',
          entityId: id,
          metadata: { number: inv.number, to: client.email, remindersScheduled: scheduled },
          ip: req.ip,
        });
        return loadInvoiceDto(tx, id);
      });
    },
  );

  app.post(
    '/:id/payments',
    { schema: { params: idParam, body: recordPaymentSchema, tags: ['invoices'] } },
    async (req): Promise<InvoiceDto> => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof recordPaymentSchema>;
      const auth = req.auth!;
      return withTenant(auth.tenantId, async (tx) => {
        const inv = await lockInvoice(tx, id);
        if (!['sent', 'viewed', 'overdue'].includes(inv.status))
          throw conflict(`Cannot record a payment on a ${inv.status} invoice`, 'INVOICE_NOT_OPEN');
        const remaining = inv.total_cents - inv.amount_paid_cents;
        const amount = body.amountCents ?? remaining;
        if (amount > remaining)
          throw unprocessable(
            `Payment exceeds the remaining balance (${remaining})`,
            'OVERPAYMENT',
          );
        await tx.execute(
          `INSERT INTO invoice_payments (tenant_id, invoice_id, amount_cents, paid_at, method, note, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            auth.tenantId,
            id,
            amount,
            body.paidAt ?? todayIso(),
            body.method,
            body.note ?? null,
            auth.userId,
          ],
        );
        const paidInFull = amount === remaining;
        await tx.execute(
          `UPDATE invoices SET amount_paid_cents = amount_paid_cents + $2, status = CASE WHEN $3 THEN 'paid' ELSE status END, paid_at = CASE WHEN $3 THEN now() ELSE paid_at END WHERE id = $1`,
          [id, amount, paidInFull],
        );
        if (paidInFull) await skipPendingReminders(tx, id, 'invoice paid');
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: paidInFull ? 'invoice.paid' : 'invoice.partially_paid',
          entityType: 'invoice',
          entityId: id,
          metadata: { number: inv.number, amountCents: amount, method: body.method },
          ip: req.ip,
        });
        return loadInvoiceDto(tx, id);
      });
    },
  );

  app.post(
    '/:id/void',
    { schema: { params: idParam, tags: ['invoices'] } },
    async (req): Promise<InvoiceDto> => {
      const { id } = req.params as { id: string };
      const auth = req.auth!;
      return withTenant(auth.tenantId, async (tx) => {
        const inv = await lockInvoice(tx, id);
        if (inv.status === 'paid' || inv.status === 'void')
          throw conflict(`Cannot void a ${inv.status} invoice`, 'INVOICE_NOT_VOIDABLE');
        await tx.execute(`UPDATE invoices SET status = 'void', voided_at = now() WHERE id = $1`, [
          id,
        ]);
        await skipPendingReminders(tx, id, 'invoice voided');
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'invoice.voided',
          entityType: 'invoice',
          entityId: id,
          metadata: { number: inv.number },
          ip: req.ip,
        });
        return loadInvoiceDto(tx, id);
      });
    },
  );
};
