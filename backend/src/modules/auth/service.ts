import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { MeDto, Role, TenantDto, UserDto } from '@duenudge/shared';
import { config } from '../../config.js';
import type { Tx } from '../../db/tx.js';
import { hashPassword, randomToken, sha256 } from '../../lib/crypto.js';
import { signAccessToken } from '../../lib/jwt.js';
import { AppError, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { slugify } from '../../lib/slug.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../plugins/auth.js';
import { getSubscription, getUsage } from '../usage/service.js';
import { audit } from '../audit/service.js';
import { enqueueEmail } from '../../email/service.js';
import { welcomeEmail } from '../../email/templates.js';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  is_platform_admin: boolean;
  created_at: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Thrown when a *revoked* refresh token is presented again. The caller must revoke the whole family in a
 * NEW transaction: the transaction that detected the reuse rolls back when this error propagates.
 */
export class SessionReuseError extends AppError {
  constructor(public readonly familyId: string) {
    super(
      401,
      'SESSION_REUSE_DETECTED',
      'Session token reuse detected; all sessions for this device family were revoked',
    );
  }
}

export const toUserDto = (u: UserRow): UserDto => ({
  id: u.id,
  email: u.email,
  name: u.name,
  isPlatformAdmin: u.is_platform_admin,
  createdAt: u.created_at,
});

export const TENANT_SELECT = `id, name, slug, currency, timezone, business_email AS "businessEmail", business_address AS "businessAddress",
  logo_url AS "logoUrl", reminder_offsets AS "reminderOffsets", default_payment_terms_days AS "defaultPaymentTermsDays",
  onboarded_at AS "onboardedAt", suspended_at AS "suspendedAt", created_at AS "createdAt"`;

// ─── Users & tenants ─────────────────────────────────────────────────────────
export async function createUser(
  tx: Tx,
  input: { email: string; name: string; password?: string },
): Promise<UserRow> {
  const existing = await tx.maybeOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    input.email,
  ]);
  if (existing) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
  const hash = input.password ? await hashPassword(input.password) : null;
  return tx.one<UserRow>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     RETURNING id, email, name, password_hash, is_platform_admin, created_at`,
    [input.email, input.name, hash],
  );
}

export async function createTenantForUser(
  tx: Tx,
  userId: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const base = slugify(name);
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const taken = await tx.maybeOne(`SELECT 1 FROM tenants WHERE slug = $1`, [slug]);
    if (!taken) break;
    slug = `${base}-${randomToken(3)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')}`;
  }
  const tenant = await tx.one<{ id: string; slug: string }>(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, slug`,
    [name, slug],
  );
  await tx.execute(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    tenant.id,
    userId,
  ]);
  await tx.execute(
    `INSERT INTO subscriptions (tenant_id, plan, status) VALUES ($1, 'free', 'active')`,
    [tenant.id],
  );
  // invoice_counters / usage rows are tenant-scoped: the system context of the caller's tx satisfies RLS.
  await tx.execute(`INSERT INTO invoice_counters (tenant_id) VALUES ($1)`, [tenant.id]);
  await audit(tx, {
    tenantId: tenant.id,
    actorUserId: userId,
    action: 'tenant.created',
    entityType: 'tenant',
    entityId: tenant.id,
  });
  return tenant;
}

export async function sendWelcome(
  tx: Tx,
  tenantId: string,
  user: { email: string; name: string },
): Promise<void> {
  await enqueueEmail(tx, {
    tenantId,
    to: user.email,
    template: 'welcome',
    ...welcomeEmail({ name: user.name, appUrl: config.APP_URL }),
  });
}

// ─── Sessions ────────────────────────────────────────────────────────────────
export interface SessionContext {
  userId: string;
  tenantId: string;
  role: Role;
  isPlatformAdmin: boolean;
}

export async function issueSession(
  tx: Tx,
  ctx: SessionContext,
  meta: { userAgent?: string | null; ip?: string | null; familyId?: string } = {},
): Promise<SessionTokens> {
  const raw = randomToken(48);
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await tx.execute(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, tenant_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      ctx.userId,
      meta.familyId ?? randomUUID(),
      sha256(raw),
      ctx.tenantId,
      expiresAt,
      meta.userAgent ?? null,
      meta.ip ?? null,
    ],
  );
  const accessToken = await signAccessToken({
    sub: ctx.userId,
    tid: ctx.tenantId,
    role: ctx.role,
    pa: ctx.isPlatformAdmin,
  });
  return { accessToken, refreshToken: raw, refreshExpiresAt: expiresAt };
}

/** Resolves the membership a session should use, verifying the tenant is not suspended. */
export async function resolveMembership(
  tx: Tx,
  userId: string,
  tenantId?: string | null,
): Promise<SessionContext> {
  const row = await tx.maybeOne<{
    tenant_id: string;
    role: Role;
    suspended_at: string | null;
    is_platform_admin: boolean;
  }>(
    `SELECT m.tenant_id, m.role, t.suspended_at, u.is_platform_admin
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.tenant_id = $2)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at
     LIMIT 1`,
    [userId, tenantId ?? null],
  );
  if (!row) throw forbidden('You are not a member of this workspace');
  if (row.suspended_at)
    throw new AppError(
      403,
      'TENANT_SUSPENDED',
      'This workspace has been suspended. Contact support.',
    );
  return {
    userId,
    tenantId: row.tenant_id,
    role: row.role,
    isPlatformAdmin: row.is_platform_admin,
  };
}

/**
 * Refresh-token rotation with reuse detection: each refresh revokes the presented token and issues a
 * new one in the same family. If a revoked token is presented again (stolen + replayed), the entire
 * family is revoked, logging out every device that descended from it.
 */
export async function rotateRefreshToken(
  tx: Tx,
  rawToken: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<{ tokens: SessionTokens; ctx: SessionContext }> {
  const hash = sha256(rawToken);
  const row = await tx.maybeOne<{
    id: string;
    user_id: string;
    family_id: string;
    tenant_id: string | null;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT id, user_id, family_id, tenant_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
    [hash],
  );
  if (!row) throw unauthorized('Invalid session');
  if (row.revoked_at) throw new SessionReuseError(row.family_id);
  if (new Date(row.expires_at).getTime() < Date.now()) throw unauthorized('Session expired');

  const ctx = await resolveMembership(tx, row.user_id, row.tenant_id);
  const tokens = await issueSession(tx, ctx, { ...meta, familyId: row.family_id });
  await tx.execute(
    `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = (SELECT id FROM refresh_tokens WHERE token_hash = $2) WHERE id = $1`,
    [row.id, sha256(tokens.refreshToken)],
  );
  return { tokens, ctx };
}

export async function revokeRefreshToken(tx: Tx, rawToken: string): Promise<void> {
  await tx.execute(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(rawToken)],
  );
}

export async function revokeTokenFamily(tx: Tx, familyId: string): Promise<void> {
  await tx.execute(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  );
}

export async function revokeAllUserSessions(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

// ─── Cookies ─────────────────────────────────────────────────────────────────
const cookieBase = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.COOKIE_SECURE || config.isProd,
  path: '/',
};

export function setAuthCookies(reply: FastifyReply, tokens: SessionTokens): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...cookieBase,
    maxAge: config.ACCESS_TOKEN_TTL_SECONDS,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieBase,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, cookieBase);
  reply.clearCookie(REFRESH_COOKIE, cookieBase);
}

export function requestMeta(req: FastifyRequest): { userAgent: string | null; ip: string | null } {
  return {
    userAgent: (req.headers['user-agent'] ?? null)?.slice(0, 300) ?? null,
    ip: req.ip ?? null,
  };
}

// ─── /me ─────────────────────────────────────────────────────────────────────
export async function buildMe(tx: Tx, ctx: SessionContext): Promise<MeDto> {
  const user = await tx.one<UserRow>(
    `SELECT id, email, name, password_hash, is_platform_admin, created_at FROM users WHERE id = $1`,
    [ctx.userId],
    'User',
  );
  const tenant = await tx.one<TenantDto>(
    `SELECT ${TENANT_SELECT} FROM tenants WHERE id = $1`,
    [ctx.tenantId],
    'Workspace',
  );
  const memberships = await tx.query<{ tenantId: string; tenantName: string; role: Role }>(
    `SELECT m.tenant_id AS "tenantId", t.name AS "tenantName", m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = $1 ORDER BY t.name`,
    [ctx.userId],
  );
  const subscription = await getSubscription(tx, ctx.tenantId);
  const usage = await getUsage(tx, ctx.tenantId, subscription.effectivePlan);
  return { user: toUserDto(user), tenant, role: ctx.role, memberships, subscription, usage };
}
