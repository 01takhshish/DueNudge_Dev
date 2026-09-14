import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { loginSchema, signupSchema, switchTenantSchema, type Role } from '@duenudge/shared';
import { config } from '../../config.js';
import { withSystem } from '../../db/tx.js';
import { randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { AppError, badRequest, notFound, unauthorized } from '../../lib/errors.js';
import { REFRESH_COOKIE } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { acceptInvite, getInviteByToken } from '../team/service.js';
import { authorizationUrl, exchangeCode } from './google.js';
import {
  buildMe,
  clearAuthCookies,
  createTenantForUser,
  createUser,
  issueSession,
  requestMeta,
  resolveMembership,
  revokeRefreshToken,
  revokeTokenFamily,
  rotateRefreshToken,
  SessionReuseError,
  sendWelcome,
  setAuthCookies,
  type UserRow,
} from './service.js';

const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
const GOOGLE_STATE_COOKIE = 'dn_oauth_state';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/signup',
    { ...authRateLimit, schema: { body: signupSchema, tags: ['auth'] } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof signupSchema>;
      const meta = requestMeta(req);
      const result = await withSystem(async (tx) => {
        const user = await createUser(tx, {
          email: body.email,
          name: body.name,
          password: body.password,
        });
        let tenantId: string;
        let role: Role;
        if (body.inviteToken) {
          const accepted = await acceptInvite(tx, body.inviteToken, user);
          tenantId = accepted.tenantId;
          role = accepted.role;
        } else {
          const tenant = await createTenantForUser(
            tx,
            user.id,
            body.tenantName?.trim() || `${body.name}'s workspace`,
          );
          tenantId = tenant.id;
          role = 'owner';
          await sendWelcome(tx, tenantId, user);
        }
        const tokens = await issueSession(
          tx,
          { userId: user.id, tenantId, role, isPlatformAdmin: user.is_platform_admin },
          meta,
        );
        await audit(tx, {
          tenantId,
          actorUserId: user.id,
          action: 'user.signed_up',
          entityType: 'user',
          entityId: user.id,
          ip: meta.ip,
        });
        const me = await buildMe(tx, {
          userId: user.id,
          tenantId,
          role,
          isPlatformAdmin: user.is_platform_admin,
        });
        return { tokens, me };
      });
      setAuthCookies(reply, result.tokens);
      return reply.status(201).send(result.me);
    },
  );

  app.post(
    '/login',
    { ...authRateLimit, schema: { body: loginSchema, tags: ['auth'] } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof loginSchema>;
      const meta = requestMeta(req);
      const result = await withSystem(async (tx) => {
        const user = await tx.maybeOne<UserRow>(
          `SELECT id, email, name, password_hash, is_platform_admin, created_at FROM users WHERE email = $1`,
          [body.email],
        );
        // Constant-ish time: verify against a dummy hash when the user does not exist.
        const ok = user?.password_hash
          ? await verifyPassword(body.password, user.password_hash)
          : (await verifyPassword(body.password, DUMMY_HASH), false);
        if (!user || !ok)
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
        const ctx = await resolveMembership(tx, user.id);
        const tokens = await issueSession(tx, ctx, meta);
        await audit(tx, {
          tenantId: ctx.tenantId,
          actorUserId: user.id,
          action: 'user.logged_in',
          entityType: 'user',
          entityId: user.id,
          ip: meta.ip,
        });
        return { tokens, me: await buildMe(tx, ctx) };
      });
      setAuthCookies(reply, result.tokens);
      return result.me;
    },
  );

  app.post(
    '/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['auth'] } },
    async (req, reply) => {
      const raw = req.cookies[REFRESH_COOKIE];
      if (!raw) throw unauthorized('No session');
      try {
        const { tokens } = await withSystem((tx) => rotateRefreshToken(tx, raw, requestMeta(req)));
        setAuthCookies(reply, tokens);
        return { ok: true };
      } catch (err) {
        clearAuthCookies(reply);
        if (err instanceof SessionReuseError) {
          // The detecting transaction rolled back; revoke the family for real, then report.
          await withSystem((tx) => revokeTokenFamily(tx, err.familyId));
          req.log.warn({ familyId: err.familyId }, 'refresh token reuse detected; family revoked');
        }
        throw err;
      }
    },
  );

  app.post('/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) await withSystem((tx) => revokeRefreshToken(tx, raw));
    clearAuthCookies(reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: app.authenticate, schema: { tags: ['auth'] } }, async (req) => {
    const auth = req.auth!;
    return withSystem((tx) => buildMe(tx, auth));
  });

  app.post(
    '/switch-tenant',
    { preHandler: app.authenticate, schema: { body: switchTenantSchema, tags: ['auth'] } },
    async (req, reply) => {
      const { tenantId } = req.body as z.infer<typeof switchTenantSchema>;
      const auth = req.auth!;
      const raw = req.cookies[REFRESH_COOKIE];
      const result = await withSystem(async (tx) => {
        const ctx = await resolveMembership(tx, auth.userId, tenantId);
        if (raw) await revokeRefreshToken(tx, raw);
        const tokens = await issueSession(tx, ctx, requestMeta(req));
        return { tokens, me: await buildMe(tx, ctx) };
      });
      setAuthCookies(reply, result.tokens);
      return result.me;
    },
  );

  // ─── Invites (public lookup; accept requires auth) ─────────────────────────
  app.get(
    '/invites/:token',
    { schema: { params: z.object({ token: z.string().min(10) }), tags: ['auth'] } },
    async (req) => {
      const { token } = req.params as { token: string };
      const invite = await withSystem((tx) => getInviteByToken(tx, token));
      if (!invite) throw notFound('Invitation');
      return {
        email: invite.email,
        role: invite.role,
        tenantName: invite.tenant_name,
        expiresAt: invite.expires_at,
      };
    },
  );

  app.post(
    '/invites/:token/accept',
    {
      preHandler: app.authenticate,
      schema: { params: z.object({ token: z.string().min(10) }), tags: ['auth'] },
    },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const auth = req.auth!;
      const result = await withSystem(async (tx) => {
        const user = await tx.one<UserRow>(
          `SELECT id, email, name, password_hash, is_platform_admin, created_at FROM users WHERE id = $1`,
          [auth.userId],
          'User',
        );
        const accepted = await acceptInvite(tx, token, user);
        const ctx = await resolveMembership(tx, user.id, accepted.tenantId);
        const tokens = await issueSession(tx, ctx, requestMeta(req));
        return { tokens, me: await buildMe(tx, ctx) };
      });
      setAuthCookies(reply, result.tokens);
      return result.me;
    },
  );

  // ─── Google OAuth ──────────────────────────────────────────────────────────
  app.get(
    '/google',
    { schema: { querystring: z.object({ invite: z.string().optional() }), tags: ['auth'] } },
    async (req, reply) => {
      if (!config.googleEnabled)
        throw new AppError(503, 'OAUTH_NOT_CONFIGURED', 'Google sign-in is not configured');
      const { invite } = req.query as { invite?: string };
      const nonce = randomToken(16);
      const state = Buffer.from(JSON.stringify({ n: nonce, i: invite ?? null })).toString(
        'base64url',
      );
      reply.setCookie(GOOGLE_STATE_COOKIE, sha256(nonce), {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.COOKIE_SECURE || config.isProd,
        path: '/api/v1/auth/google',
        maxAge: 600,
      });
      return reply.redirect(authorizationUrl(state));
    },
  );

  app.get(
    '/google/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
        tags: ['auth'],
      },
    },
    async (req, reply) => {
      const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
      if (error || !code || !state) return reply.redirect(`${config.APP_URL}/login?error=google`);
      let parsed: { n: string; i: string | null };
      try {
        parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      } catch {
        throw badRequest('Invalid OAuth state');
      }
      const expected = req.cookies[GOOGLE_STATE_COOKIE];
      reply.clearCookie(GOOGLE_STATE_COOKIE, { path: '/api/v1/auth/google' });
      if (!expected || expected !== sha256(parsed.n)) throw badRequest('OAuth state mismatch');

      const profile = await exchangeCode(code);
      const meta = requestMeta(req);
      const tokens = await withSystem(async (tx) => {
        let user = await tx.maybeOne<UserRow>(
          `SELECT u.id, u.email, u.name, u.password_hash, u.is_platform_admin, u.created_at FROM oauth_accounts o JOIN users u ON u.id = o.user_id
         WHERE o.provider = 'google' AND o.provider_user_id = $1`,
          [profile.sub],
        );
        let isNew = false;
        if (!user) {
          user = await tx.maybeOne<UserRow>(
            `SELECT id, email, name, password_hash, is_platform_admin, created_at FROM users WHERE email = $1`,
            [profile.email],
          );
          if (user && !profile.emailVerified) throw badRequest('Google email is not verified');
          if (!user) {
            user = await createUser(tx, { email: profile.email, name: profile.name });
            isNew = true;
          }
          await tx.execute(
            `INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES ($1, 'google', $2) ON CONFLICT DO NOTHING`,
            [user.id, profile.sub],
          );
          await tx.execute(
            `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`,
            [user.id],
          );
        }
        let tenantId: string | null = null;
        if (parsed.i) {
          const accepted = await acceptInvite(tx, parsed.i, user);
          tenantId = accepted.tenantId;
        } else if (isNew) {
          const t = await createTenantForUser(tx, user.id, `${user.name}'s workspace`);
          tenantId = t.id;
          await sendWelcome(tx, tenantId, user);
        }
        const ctx = await resolveMembership(tx, user.id, tenantId);
        await audit(tx, {
          tenantId: ctx.tenantId,
          actorUserId: user.id,
          action: 'user.logged_in',
          entityType: 'user',
          entityId: user.id,
          metadata: { provider: 'google' },
          ip: meta.ip,
        });
        return issueSession(tx, ctx, meta);
      });
      setAuthCookies(reply, tokens);
      return reply.redirect(`${config.APP_URL}/app`);
    },
  );
};

// A valid scrypt hash of a random string; used so login timing does not reveal whether an email exists.
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
