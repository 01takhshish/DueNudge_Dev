import type { FastifyPluginAsync } from 'fastify';
import type { DashboardDto } from '@duenudge/shared';
import { withTenant } from '../../db/tx.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/summary', { schema: { tags: ['dashboard'] } }, async (req): Promise<DashboardDto> => {
    const auth = req.auth!;
    return withTenant(auth.tenantId, async (tx) => {
      const tenant = await tx.one<{ currency: string }>(
        `SELECT currency FROM tenants WHERE id = $1`,
        [auth.tenantId],
      );
      const [totals] = await tx.query<{
        outstanding: number;
        overdue: number;
        overdue_count: number;
        paid_month: number;
        drafts: number;
      }>(
        `SELECT
           COALESCE(sum(total_cents - amount_paid_cents) FILTER (WHERE status IN ('sent','viewed','overdue')), 0) AS outstanding,
           COALESCE(sum(total_cents - amount_paid_cents) FILTER (WHERE status = 'overdue'), 0) AS overdue,
           count(*) FILTER (WHERE status = 'overdue')::int AS overdue_count,
           COALESCE((SELECT sum(amount_cents) FROM invoice_payments WHERE paid_at >= date_trunc('month', current_date)), 0) AS paid_month,
           count(*) FILTER (WHERE status = 'draft')::int AS drafts
         FROM invoices`,
      );
      const upcomingReminders = await tx.query<DashboardDto['upcomingReminders'][number]>(
        `SELECT r.id, r.invoice_id AS "invoiceId", i.number AS "invoiceNumber", c.name AS "clientName", r.scheduled_for AS "scheduledFor", r.kind
         FROM reminders r JOIN invoices i ON i.id = r.invoice_id JOIN clients c ON c.id = i.client_id
         WHERE r.status = 'pending' AND r.scheduled_for < now() + interval '7 days' AND i.status IN ('sent','viewed','overdue')
         ORDER BY r.scheduled_for LIMIT 10`,
      );
      const recentActivity = await tx.query<DashboardDto['recentActivity'][number]>(
        `SELECT a.id::text, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", u.name AS "actorName", a.metadata, a.created_at AS "createdAt"
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 10`,
      );
      return {
        currency: tenant.currency,
        outstandingCents: Number(totals?.outstanding ?? 0),
        overdueCents: Number(totals?.overdue ?? 0),
        overdueCount: totals?.overdue_count ?? 0,
        paidThisMonthCents: Number(totals?.paid_month ?? 0),
        draftCount: totals?.drafts ?? 0,
        upcomingReminders,
        recentActivity,
      };
    });
  });
};
