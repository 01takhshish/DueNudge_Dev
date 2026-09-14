import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createInviteSchema, updateMemberSchema, type TeamDto } from '@duenudge/shared';
import { config } from '../../config.js';
import { withSystem, withTenant } from '../../db/tx.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { enqueueEmail } from '../../email/service.js';
import { inviteEmail } from '../../email/templates.js';
import { audit } from '../audit/service.js';
import { assertWithinLimit } from '../usage/service.js';
import { revokeAllUserSessions } from '../auth/service.js';

const idParam = z.object({ id: z.uuid() });
const userParam = z.object({ userId: z.uuid() });

export const teamRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { schema: { tags: ['team'] } }, async (req): Promise<TeamDto> => {
    const auth = req.auth!;
    return withTenant(auth.tenantId, async (tx) => {
      const members = await tx.query<TeamDto['members'][number]>(
        `SELECT m.user_id AS "userId", u.name, u.email, m.role, m.created_at AS "joinedAt"
         FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at`,
        [auth.tenantId],
      );
      const invites = await tx.query<TeamDto['invites'][number]>(
        `SELECT id, email, role, expires_at AS "expiresAt", created_at AS "createdAt" FROM invites
         WHERE accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
      );
      return { members, invites };
    });
  });

  app.post(
    '/invites',
    { preHandler: app.requireRole('admin'), schema: { body: createInviteSchema, tags: ['team'] } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof createInviteSchema>;
      const auth = req.auth!;
      if (body.role === 'admin' && auth.role !== 'owner')
        throw forbidden('Only the owner can invite admins');
      const invite = await withTenant(auth.tenantId, async (tx) => {
        const already = await tx.maybeOne(
          `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 AND u.email = $2`,
          [auth.tenantId, body.email],
        );
        if (already) throw conflict('That person is already a member', 'ALREADY_MEMBER');
        const pending = await tx.maybeOne(
          `SELECT 1 FROM invites WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()`,
          [body.email],
        );
        if (pending)
          throw conflict('An invitation is already pending for that email', 'INVITE_PENDING');
        await assertWithinLimit(tx, auth.tenantId, 'members');

        const raw = randomToken(32);
        const row = await tx.one<{ id: string; expires_at: string; created_at: string }>(
          `INSERT INTO invites (tenant_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '7 days') RETURNING id, expires_at, created_at`,
          [auth.tenantId, body.email, body.role, sha256(raw), auth.userId],
        );
        const inviter = await tx.one<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
          auth.userId,
        ]);
        const tenant = await tx.one<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
          auth.tenantId,
        ]);
        await enqueueEmail(tx, {
          tenantId: auth.tenantId,
          to: body.email,
          template: 'invite',
          ...inviteEmail({
            inviterName: inviter.name,
            tenantName: tenant.name,
            role: body.role,
            acceptUrl: `${config.APP_URL}/invite/${raw}`,
          }),
        });
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'invite.created',
          entityType: 'invite',
          entityId: row.id,
          metadata: { email: body.email, role: body.role },
          ip: req.ip,
        });
        return {
          id: row.id,
          email: body.email,
          role: body.role,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        };
      });
      return reply.status(201).send(invite);
    },
  );

  app.delete(
    '/invites/:id',
    { preHandler: app.requireRole('admin'), schema: { params: idParam, tags: ['team'] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const auth = req.auth!;
      await withTenant(auth.tenantId, async (tx) => {
        const n = await tx.execute(`DELETE FROM invites WHERE id = $1 AND accepted_at IS NULL`, [
          id,
        ]);
        if (!n) throw notFound('Invitation');
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'invite.revoked',
          entityType: 'invite',
          entityId: id,
          ip: req.ip,
        });
      });
      return { ok: true };
    },
  );

  app.patch(
    '/members/:userId',
    {
      preHandler: app.requireRole('owner'),
      schema: { params: userParam, body: updateMemberSchema, tags: ['team'] },
    },
    async (req) => {
      const { userId } = req.params as { userId: string };
      const { role } = req.body as z.infer<typeof updateMemberSchema>;
      const auth = req.auth!;
      if (userId === auth.userId) throw forbidden('The owner role cannot be changed here');
      await withSystem(async (tx) => {
        const n = await tx.execute(
          `UPDATE memberships SET role = $1 WHERE tenant_id = $2 AND user_id = $3 AND role <> 'owner'`,
          [role, auth.tenantId, userId],
        );
        if (!n) throw notFound('Member');
        await revokeAllUserSessions(tx, userId); // force re-login so the new role lands in the JWT
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'member.role_changed',
          entityType: 'membership',
          entityId: userId,
          metadata: { role },
          ip: req.ip,
        });
      });
      return { ok: true };
    },
  );

  app.delete(
    '/members/:userId',
    { preHandler: app.requireRole('admin'), schema: { params: userParam, tags: ['team'] } },
    async (req) => {
      const { userId } = req.params as { userId: string };
      const auth = req.auth!;
      await withSystem(async (tx) => {
        const target = await tx.maybeOne<{ role: string }>(
          `SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
          [auth.tenantId, userId],
        );
        if (!target) throw notFound('Member');
        if (target.role === 'owner') throw forbidden('The owner cannot be removed');
        if (target.role === 'admin' && auth.role !== 'owner')
          throw forbidden('Only the owner can remove admins');
        await tx.execute(`DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [
          auth.tenantId,
          userId,
        ]);
        await revokeAllUserSessions(tx, userId);
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'member.removed',
          entityType: 'membership',
          entityId: userId,
          ip: req.ip,
        });
      });
      return { ok: true };
    },
  );
};
