import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDatabase } from '../helpers/db.js';
import { cookieHeader, enqueued, makeApp, signup } from '../helpers/app.js';
import { closePool } from '../../src/db/pool.js';
import { withSystem } from '../../src/db/tx.js';
import { sha256 } from '../../src/lib/crypto.js';

let app: FastifyInstance;
beforeAll(async () => {
  await resetDatabase();
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closePool();
});

const refreshOf = (cookie: string) =>
  cookie
    .split('; ')
    .find((c) => c.startsWith('dn_refresh='))!
    .split('=')[1]!;

describe('auth', () => {
  it('signup creates user + tenant + owner membership + free subscription and sets cookies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'Owner@Example.com',
        password: 'Password123!',
        name: 'Owner',
        tenantName: 'Owner Co',
      },
    });
    expect(res.statusCode).toBe(201);
    const me = res.json();
    expect(me.user.email).toBe('owner@example.com');
    expect(me.role).toBe('owner');
    expect(me.subscription.effectivePlan).toBe('free');
    expect(me.usage.metrics.clients).toEqual({ used: 0, limit: 3 });
    const names = res.cookies.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['dn_access', 'dn_refresh']));
    expect(res.cookies.every((c) => c.httpOnly)).toBe(true);
    expect(enqueued.some((e) => e.type === 'email')).toBe(true); // welcome email queued
  });

  it('rejects duplicate email, weak passwords, bad payloads with the error envelope', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'owner@example.com', password: 'Password123!', name: 'X' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('EMAIL_TAKEN');
    const weak = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'w@example.com', password: 'short', name: 'X' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('VALIDATION_ERROR');
    expect(weak.json().error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'password' })]),
    );
    expect(weak.json().error.requestId).toBeTruthy();
  });

  it('login works with correct password and fails otherwise', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.com', password: 'Password123!' },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.com', password: 'Password123x' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');
    const nobody = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'Password123!' },
    });
    expect(nobody.statusCode).toBe(401);
  });

  it('protected routes require auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('refresh rotates the token; replaying the old token revokes the whole family', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.com', password: 'Password123!' },
    });
    const cookie1 = cookieHeader(login);
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookie1 },
    });
    expect(r1.statusCode).toBe(200);
    const cookie2 = cookieHeader(r1, cookie1);
    expect(refreshOf(cookie2)).not.toBe(refreshOf(cookie1));

    // New token works
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookie2 } }))
        .statusCode,
    ).toBe(200);

    // Replay of the OLD refresh token => reuse detected => family revoked
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookie1 },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('SESSION_REUSE_DETECTED');
    const after = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookie2 },
    });
    expect(after.statusCode).toBe(401);
    const row = await withSystem((tx) =>
      tx.one<{ revoked_at: string | null }>(
        `SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1`,
        [sha256(refreshOf(cookie2))],
      ),
    );
    expect(row.revoked_at).not.toBeNull();
  });

  it('logout revokes the refresh token and clears cookies', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.com', password: 'Password123!' },
    });
    const cookie = cookieHeader(login);
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    expect(out.cookies.find((c) => c.name === 'dn_refresh')?.value).toBe('');
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it('invite flow: owner invites, invitee signs up with the token and lands in the tenant as member', async () => {
    const owner = await signup(app, 'inviter@example.com', { tenantName: 'Invite Co' });
    const inv = await app.inject({
      method: 'POST',
      url: '/api/v1/team/invites',
      headers: { cookie: owner.cookie },
      payload: { email: 'newbie@example.com', role: 'member' },
    });
    expect(inv.statusCode).toBe(402); // free plan: 1 member
    expect(inv.json().error.code).toBe('PLAN_LIMIT_REACHED');

    await withSystem((tx) =>
      tx.execute(`UPDATE subscriptions SET plan = 'pro', status = 'active' WHERE tenant_id = $1`, [
        owner.tenantId,
      ]),
    );
    const inv2 = await app.inject({
      method: 'POST',
      url: '/api/v1/team/invites',
      headers: { cookie: owner.cookie },
      payload: { email: 'newbie@example.com', role: 'member' },
    });
    expect(inv2.statusCode).toBe(201);
    const email = enqueued.filter((e) => e.type === 'email').at(-1)!.data as { emailLogId: string };
    const log = await withSystem((tx) =>
      tx.one<{ text: string }>(`SELECT text FROM email_log WHERE id = $1`, [email.emailLogId]),
    );
    const token = /invite\/([A-Za-z0-9_-]+)/.exec(log.text)![1]!;

    const wrongEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'other@example.com',
        password: 'Password123!',
        name: 'Other',
        inviteToken: token,
      },
    });
    expect(wrongEmail.statusCode).toBe(403);
    expect(wrongEmail.json().error.code).toBe('INVITE_EMAIL_MISMATCH');

    const member = await signup(app, 'newbie@example.com', { inviteToken: token });
    expect(member.tenantId).toBe(owner.tenantId);
    const me = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: member.cookie },
      })
    ).json();
    expect(me.role).toBe('member');

    // RBAC: member cannot invite, cannot read the audit log; owner can.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/team/invites',
          headers: { cookie: member.cookie },
          payload: { email: 'x@example.com', role: 'member' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/audit',
          headers: { cookie: member.cookie },
        })
      ).statusCode,
    ).toBe(403);
    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { cookie: owner.cookie },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().items.map((i: { action: string }) => i.action)).toEqual(
      expect.arrayContaining(['invite.created', 'member.joined']),
    );

    // Owner removes the member -> their sessions are revoked
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/team/members/${member.userId}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          headers: { cookie: member.cookie },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('platform admin routes are locked to platform admins', async () => {
    const s = await signup(app, 'pa@example.com');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/admin/overview',
          headers: { cookie: s.cookie },
        })
      ).statusCode,
    ).toBe(403);
    await withSystem((tx) =>
      tx.execute(`UPDATE users SET is_platform_admin = true WHERE id = $1`, [s.userId]),
    );
    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'pa@example.com', password: 'Password123!' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { cookie: cookieHeader(relogin) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenants).toBeGreaterThan(0);
  });
});
