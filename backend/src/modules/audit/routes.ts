import type { FastifyPluginAsync } from 'fastify';
import { paginationSchema, type AuditEntryDto, type Paginated } from '@duenudge/shared';
import { withTenant } from '../../db/tx.js';

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    {
      schema: { querystring: paginationSchema, tags: ['audit'] },
      preHandler: app.requireRole('admin'),
    },
    async (req) => {
      const { page, pageSize } = req.query as { page: number; pageSize: number };
      const auth = req.auth!;
      return withTenant(auth.tenantId, async (tx): Promise<Paginated<AuditEntryDto>> => {
        const { count } = await tx.one<{ count: number }>(
          `SELECT count(*)::int AS count FROM audit_log`,
        );
        const rows = await tx.query<AuditEntryDto>(
          `SELECT a.id::text, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", u.name AS "actorName",
                a.metadata, a.created_at AS "createdAt"
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
         ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
          [pageSize, (page - 1) * pageSize],
        );
        return { items: rows, page, pageSize, total: count ?? 0 };
      });
    },
  );
};
