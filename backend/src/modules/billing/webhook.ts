import type Stripe from 'stripe';
import type { Tx } from '../../db/tx.js';
import { config } from '../../config.js';
import { enqueueEmail } from '../../email/service.js';
import { paymentFailedEmail } from '../../email/templates.js';
import { audit } from '../audit/service.js';
import { planForPriceId } from './stripe.js';

export type WebhookOutcome = 'processed' | 'duplicate' | 'stale' | 'ignored';

/**
 * Stripe webhook processing. Runs inside ONE system transaction so the idempotency record and the
 * state change commit (or roll back) together:
 *   1. INSERT INTO stripe_events ... ON CONFLICT DO NOTHING  — a replayed event inserts 0 rows -> 'duplicate'
 *   2. per-subscription ordering guard: ignore an event older than the last one applied ('stale'),
 *      because Stripe does not guarantee delivery order.
 *   3. apply the change.
 * If (3) throws, (1) rolls back too, so Stripe's retry will be processed again — at-least-once + idempotent = exactly-once effect.
 */
export async function processStripeEvent(tx: Tx, event: Stripe.Event): Promise<WebhookOutcome> {
  const inserted = await tx.execute(
    `INSERT INTO stripe_events (id, type, event_created, payload) VALUES ($1, $2, to_timestamp($3), $4::jsonb) ON CONFLICT (id) DO NOTHING`,
    [event.id, event.type, event.created, JSON.stringify(event)],
  );
  if (!inserted) return 'duplicate';

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenantId = session.client_reference_id ?? session.metadata?.tenant_id;
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
      if (tenantId && customerId) {
        await tx.execute(
          `UPDATE tenants SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL`,
          [tenantId, customerId],
        );
      }
      return 'processed';
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return applySubscription(tx, event.data.object, event);
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!customerId) return 'ignored';
      const tenant = await tx.maybeOne<{ id: string; name: string }>(
        `SELECT id, name FROM tenants WHERE stripe_customer_id = $1`,
        [customerId],
      );
      if (!tenant) return 'ignored';
      await tx.execute(
        `UPDATE subscriptions SET status = 'past_due' WHERE tenant_id = $1 AND status IN ('active','trialing')`,
        [tenant.id],
      );
      const owner = await tx.maybeOne<{ email: string; name: string }>(
        `SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 AND m.role = 'owner'`,
        [tenant.id],
      );
      if (owner) {
        await enqueueEmail(tx, {
          tenantId: tenant.id,
          to: owner.email,
          template: 'payment-failed',
          ...paymentFailedEmail({
            name: owner.name,
            tenantName: tenant.name,
            billingUrl: `${config.APP_URL}/app/settings/billing`,
          }),
        });
      }
      await audit(tx, {
        tenantId: tenant.id,
        actorUserId: null,
        action: 'billing.payment_failed',
        entityType: 'subscription',
        metadata: { stripeInvoiceId: invoice.id },
      });
      return 'processed';
    }
    default:
      return 'ignored';
  }
}

async function applySubscription(
  tx: Tx,
  sub: Stripe.Subscription,
  event: Stripe.Event,
): Promise<WebhookOutcome> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const tenantId =
    sub.metadata?.tenant_id ??
    (
      await tx.maybeOne<{ id: string }>(`SELECT id FROM tenants WHERE stripe_customer_id = $1`, [
        customerId,
      ])
    )?.id;
  if (!tenantId) return 'ignored';
  await tx.execute(
    `UPDATE tenants SET stripe_customer_id = COALESCE(stripe_customer_id, $2) WHERE id = $1`,
    [tenantId, customerId],
  );

  const existing = await tx.maybeOne<{
    last_event_at: string | null;
    stripe_subscription_id: string | null;
  }>(
    `SELECT last_event_at, stripe_subscription_id FROM subscriptions WHERE tenant_id = $1 FOR UPDATE`,
    [tenantId],
  );
  const eventAt = new Date(event.created * 1000);
  if (
    existing?.last_event_at &&
    new Date(existing.last_event_at).getTime() > eventAt.getTime() &&
    existing.stripe_subscription_id === sub.id
  ) {
    return 'stale';
  }

  const item = sub.items.data[0];
  const priceId = item?.price.id ?? null;
  const deleted = event.type === 'customer.subscription.deleted' || sub.status === 'canceled';
  const plan = deleted ? 'free' : planForPriceId(priceId);
  const status = deleted ? 'canceled' : sub.status;
  const periodStart = item?.current_period_start
    ? new Date(item.current_period_start * 1000)
    : null;
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;

  await tx.execute(
    `INSERT INTO subscriptions (tenant_id, plan, status, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end, trial_ends_at, cancel_at_period_end, last_event_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id) DO UPDATE SET
       plan = EXCLUDED.plan, status = EXCLUDED.status, stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_price_id = EXCLUDED.stripe_price_id, current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end, trial_ends_at = EXCLUDED.trial_ends_at,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end, last_event_at = EXCLUDED.last_event_at`,
    [
      tenantId,
      plan,
      status,
      deleted ? null : sub.id,
      deleted ? null : priceId,
      periodStart,
      periodEnd,
      sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      sub.cancel_at_period_end,
      eventAt,
    ],
  );
  await audit(tx, {
    tenantId,
    actorUserId: null,
    action: `billing.subscription_${event.type.split('.').pop()}`,
    entityType: 'subscription',
    entityId: sub.id,
    metadata: { plan, status, priceId },
  });
  return 'processed';
}
