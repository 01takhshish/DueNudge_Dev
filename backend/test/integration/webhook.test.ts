/**
 * Stripe webhook idempotency & ordering. Events are hand-built objects shaped like Stripe.Event —
 * the signature check is exercised separately (it is Stripe's code); what we own is what happens after.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import type { FastifyInstance } from 'fastify';
import { resetDatabase } from '../helpers/db.js';
import { createClient, makeApp, signup, type Session } from '../helpers/app.js';
import { closePool } from '../../src/db/pool.js';
import { withSystem } from '../../src/db/tx.js';
import { processStripeEvent } from '../../src/modules/billing/webhook.js';

let app: FastifyInstance;
let s: Session;
beforeAll(async () => {
  await resetDatabase();
  app = await makeApp();
  s = await signup(app, 'billing@example.com');
  await withSystem((tx) =>
    tx.execute(`UPDATE tenants SET stripe_customer_id = 'cus_123' WHERE id = $1`, [s.tenantId]),
  );
});
afterAll(async () => {
  await app.close();
  await closePool();
});

let seq = 0;
function subscriptionEvent(
  type: Stripe.Event['type'],
  sub: Partial<Stripe.Subscription> & { status: Stripe.Subscription.Status; priceId: string },
  created: number,
): Stripe.Event {
  const { priceId, ...rest } = sub;
  return {
    id: `evt_${++seq}`,
    object: 'event',
    type,
    created,
    api_version: '2026-01-01',
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: {
      object: {
        id: 'sub_1',
        object: 'subscription',
        customer: 'cus_123',
        cancel_at_period_end: false,
        trial_end: null,
        metadata: {},
        items: {
          object: 'list',
          data: [
            {
              id: 'si_1',
              object: 'subscription_item',
              price: { id: priceId, object: 'price' },
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
            },
          ],
          has_more: false,
          url: '',
        },
        ...rest,
      } as unknown as Stripe.Subscription,
    },
  } as unknown as Stripe.Event;
}

describe('stripe webhook processing', () => {
  it('subscription.created upgrades the tenant to pro and lifts limits', async () => {
    const evt = subscriptionEvent(
      'customer.subscription.created',
      { status: 'trialing', priceId: 'price_test_pro', trial_end: 1_701_000_000 },
      1_700_000_100,
    );
    expect(await withSystem((tx) => processStripeEvent(tx, evt))).toBe('processed');
    const me = (
      await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } })
    ).json();
    expect(me.subscription).toMatchObject({
      plan: 'pro',
      status: 'trialing',
      effectivePlan: 'pro',
      hasStripeCustomer: true,
    });
    for (let i = 0; i < 4; i++) expect((await createClient(app, s)).statusCode).toBe(201); // > free limit of 3
  });

  it('a replayed event (same id) is a no-op', async () => {
    const evt = subscriptionEvent(
      'customer.subscription.updated',
      { status: 'active', priceId: 'price_test_business' },
      1_700_000_200,
    );
    expect(await withSystem((tx) => processStripeEvent(tx, evt))).toBe('processed');
    expect(await withSystem((tx) => processStripeEvent(tx, evt))).toBe('duplicate');
    const rows = await withSystem((tx) => tx.query(`SELECT id FROM stripe_events`));
    expect(rows).toHaveLength(2);
    const sub = await withSystem((tx) =>
      tx.one<{ plan: string }>(`SELECT plan FROM subscriptions WHERE tenant_id = $1`, [s.tenantId]),
    );
    expect(sub.plan).toBe('business');
  });

  it('an out-of-order (older) event does not overwrite newer state', async () => {
    const stale = subscriptionEvent(
      'customer.subscription.updated',
      { status: 'active', priceId: 'price_test_pro' },
      1_700_000_150,
    ); // older than the business update
    expect(await withSystem((tx) => processStripeEvent(tx, stale))).toBe('stale');
    const sub = await withSystem((tx) =>
      tx.one<{ plan: string }>(`SELECT plan FROM subscriptions WHERE tenant_id = $1`, [s.tenantId]),
    );
    expect(sub.plan).toBe('business');
  });

  it("a failing handler rolls back the idempotency record so Stripe's retry is processed", async () => {
    const evt = subscriptionEvent(
      'customer.subscription.updated',
      { status: 'active', priceId: 'price_test_pro' },
      1_700_000_300,
    );
    await expect(
      withSystem(async (tx) => {
        await processStripeEvent(tx, evt);
        throw new Error('boom after processing');
      }),
    ).rejects.toThrow('boom');
    expect(await withSystem((tx) => processStripeEvent(tx, evt))).toBe('processed'); // not 'duplicate'
  });

  it('payment_failed marks past_due (entitlements kept) and emails the owner; deleted drops to free', async () => {
    const failed = {
      id: 'evt_pf',
      object: 'event',
      type: 'invoice.payment_failed',
      created: 1_700_000_400,
      data: { object: { id: 'in_1', object: 'invoice', customer: 'cus_123' } },
    } as unknown as Stripe.Event;
    expect(await withSystem((tx) => processStripeEvent(tx, failed))).toBe('processed');
    let me = (
      await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } })
    ).json();
    expect(me.subscription).toMatchObject({ status: 'past_due', effectivePlan: 'pro' });
    const email = await withSystem((tx) =>
      tx.maybeOne(`SELECT 1 FROM email_log WHERE template = 'payment-failed' AND tenant_id = $1`, [
        s.tenantId,
      ]),
    );
    expect(email).not.toBeNull();

    const deleted = subscriptionEvent(
      'customer.subscription.deleted',
      { status: 'canceled', priceId: 'price_test_pro' },
      1_700_000_500,
    );
    expect(await withSystem((tx) => processStripeEvent(tx, deleted))).toBe('processed');
    me = (
      await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } })
    ).json();
    expect(me.subscription).toMatchObject({
      plan: 'free',
      status: 'canceled',
      effectivePlan: 'free',
    });
  });

  it('webhook endpoint rejects unsigned requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect([400, 503]).toContain(res.statusCode);
  });
});
