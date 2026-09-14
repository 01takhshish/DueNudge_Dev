import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { adminTenantsQuerySchema, PLANS } from '@duenudge/shared';
import { withSystem } from '../../db/tx.js';
import { notFound } from '../../lib/errors.js';
import { audit } from '../audit/service.js';

const idParam = z.object({ id: z.uuid() });

/** Platform-admin panel. All queries run in system context and are read-mostly. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requirePlatformAdmin);

  app.get('/overview', { schema: { tags: ['admin'] } }, async () =>
    withSystem(async (tx) => {
      const [counts] = await tx.query<{
        tenants: number;
        users: number;
        invoices: number;
        invoices_30d: number;
        reminders_sent_30d: number;
        emails_failed_7d: number;
      }>(
        `SELECT (SELECT count(*) FROM tenants)::int AS tenants,
                (SELECT count(*) FROM users)::int AS users,
                (SELECT count(*) FROM invoices)::int AS invoices,
                (SELECT count(*) FROM invoices WHERE created_at > now() - interval '30 days')::int AS invoices_30d,
                (SELECT count(*) FROM reminders WHERE status = 'sent' AND sent_at > now() - interval '30 days')::int AS reminders_sent_30d,
                (SELECT count(*) FROM email_log WHERE status = 'failed' AND created_at > now() - interval '7 days')::int AS emails_failed_7d`,
      );
      const byPlan = await tx.query<{
        plan: 'free' | 'pro' | 'business';
        status: string;
        n: number;
      }>(
        `SELECT plan, status, count(*)::int AS n FROM subscriptions GROUP BY plan, status ORDER BY plan`,
      );
      const mrrUsd = byPlan
        .filter((r) => r.status === 'active')
        .reduce((s, r) => s + PLANS[r.plan].priceMonthlyUsd * r.n, 0);
      const aiCost = await tx.maybeOne<{ micros: number }>(
        `SELECT COALESCE(sum(cost_micros), 0) AS micros FROM ai_drafts WHERE created_at > now() - interval '30 days'`,
      );
      return { ...counts, byPlan, mrrUsd, aiCostUsd30d: Number(aiCost?.micros ?? 0) / 1_000_000 };
    }),
  );

  app.get(
    '/tenants',
    { schema: { querystring: adminTenantsQuerySchema, tags: ['admin'] } },
    async (req) => {
      const q = req.query as z.infer<typeof adminTenantsQuerySchema>;
      return withSystem(async (tx) => {
        const params: unknown[] = [];
        let where = '';
        if (q.q) {
          params.push(`%${q.q}%`);
          where = `WHERE t.name ILIKE $1 OR t.slug ILIKE $1 OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = t.id AND u.email ILIKE $1)`;
        }
        const { count } = await tx.one<{ count: number }>(
          `SELECT count(*)::int AS count FROM tenants t ${where}`,
          params,
        );
        params.push(q.pageSize, (q.page - 1) * q.pageSize);
        const items = await tx.query(
          `SELECT t.id, t.name, t.slug, t.created_at AS "createdAt", t.suspended_at AS "suspendedAt", t.onboarded_at AS "onboardedAt",
                s.plan, s.status AS "subscriptionStatus",
                (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = t.id AND m.role = 'owner' LIMIT 1) AS "ownerEmail",
                (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id)::int AS members,
                (SELECT count(*) FROM invoices i WHERE i.tenant_id = t.id)::int AS invoices,
                (SELECT count(*) FROM clients c WHERE c.tenant_id = t.id AND c.archived_at IS NULL)::int AS clients
         FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id ${where}
         ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        return { items, page: q.page, pageSize: q.pageSize, total: count ?? 0 };
      });
    },
  );

  app.post(
    '/tenants/:id/suspend',
    { schema: { params: idParam, tags: ['admin'] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const auth = req.auth!;
      await withSystem(async (tx) => {
        const n = await tx.execute(
          `UPDATE tenants SET suspended_at = now() WHERE id = $1 AND suspended_at IS NULL`,
          [id],
        );
        if (!n) throw notFound('Tenant');
        // Kill sessions so the suspension takes effect within one access-token TTL (15 min).
        await tx.execute(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE tenant_id = $1 AND revoked_at IS NULL`,
          [id],
        );
        await audit(tx, {
          tenantId: id,
          actorUserId: auth.userId,
          action: 'tenant.suspended',
          entityType: 'tenant',
          entityId: id,
          ip: req.ip,
        });
      });
      return { ok: true };
    },
  );

  app.post(
    '/tenants/:id/unsuspend',
    { schema: { params: idParam, tags: ['admin'] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const auth = req.auth!;
      await withSystem(async (tx) => {
        const n = await tx.execute(
          `UPDATE tenants SET suspended_at = NULL WHERE id = $1 AND suspended_at IS NOT NULL`,
          [id],
        );
        if (!n) throw notFound('Tenant');
        await audit(tx, {
          tenantId: id,
          actorUserId: auth.userId,
          action: 'tenant.unsuspended',
          entityType: 'tenant',
          entityId: id,
          ip: req.ip,
        });
      });
      return { ok: true };
    },
  );
};
