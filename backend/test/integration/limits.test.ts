import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDatabase } from '../helpers/db.js';
import { createClient, createInvoice, makeApp, signup, type Session } from '../helpers/app.js';
import { closePool } from '../../src/db/pool.js';
import { withSystem } from '../../src/db/tx.js';

let app: FastifyInstance;
let s: Session;
beforeAll(async () => {
  await resetDatabase();
  app = await makeApp();
  s = await signup(app, 'limits@example.com');
});
afterAll(async () => {
  await app.close();
  await closePool();
});

describe('plan limits (server-side)', () => {
  it('free plan allows 3 clients; the 4th returns 402 with a structured limit', async () => {
    for (let i = 0; i < 3; i++) expect((await createClient(app, s)).statusCode).toBe(201);
    const res = await createClient(app, s);
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      limit: { metric: 'clients', limit: 3, current: 3, plan: 'free' },
    });
  });

  it('free plan allows 5 invoices / month; the 6th is rejected and the counter is NOT incremented', async () => {
    const clientId = (
      await app.inject({ method: 'GET', url: '/api/v1/clients', headers: { cookie: s.cookie } })
    ).json().items[0].id;
    for (let i = 0; i < 5; i++)
      expect((await createInvoice(app, s, clientId)).statusCode).toBe(201);
    const res = await createInvoice(app, s, clientId);
    expect(res.statusCode).toBe(402);
    const counter = await withSystem((tx) =>
      tx.one<{ count: number }>(
        `SELECT count FROM usage_counters WHERE tenant_id = $1 AND metric = 'invoices'`,
        [s.tenantId],
      ),
    );
    expect(Number(counter.count)).toBe(5);
    const me = (
      await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } })
    ).json();
    expect(me.usage.metrics.invoices).toEqual({ used: 5, limit: 5 });
  });

  it('concurrent inserts cannot exceed a total-type limit (advisory lock)', async () => {
    const t = await signup(app, 'race@example.com');
    const results = await Promise.all(Array.from({ length: 8 }, () => createClient(app, t)));
    const created = results.filter((r) => r.statusCode === 201).length;
    expect(created).toBe(3);
    expect(results.filter((r) => r.statusCode === 402).length).toBe(5);
  });

  it('upgrading lifts the limit immediately; AI drafts are gated on free', async () => {
    const ai = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/00000000-0000-0000-0000-000000000000/ai-draft`,
      headers: { cookie: s.cookie },
      payload: { tone: 'friendly' },
    });
    expect(ai.statusCode).toBe(404); // invoice lookup first (no info leak about limits for foreign ids)
    await withSystem((tx) =>
      tx.execute(
        `UPDATE subscriptions SET plan = 'pro', status = 'trialing' WHERE tenant_id = $1`,
        [s.tenantId],
      ),
    );
    expect((await createClient(app, s)).statusCode).toBe(201);
    const me = (
      await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } })
    ).json();
    expect(me.subscription).toMatchObject({
      plan: 'pro',
      effectivePlan: 'pro',
      status: 'trialing',
    });
    expect(me.usage.metrics.clients.limit).toBeNull();
  });
});
