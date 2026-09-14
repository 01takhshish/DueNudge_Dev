import {
  METRIC_KIND,
  PLANS,
  type Metric,
  type PlanId,
  type SubscriptionDto,
  type UsageDto,
} from '@duenudge/shared';
import type { Tx } from '../../db/tx.js';
import { PlanLimitError } from '../../lib/errors.js';
import { currentPeriod } from '../../lib/dates.js';

interface SubscriptionRow {
  plan: PlanId;
  status: SubscriptionDto['status'];
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
}

/** The plan whose limits actually apply right now. `past_due` keeps entitlements (Stripe is retrying). */
export function effectivePlan(plan: PlanId, status: SubscriptionDto['status']): PlanId {
  if (plan === 'free') return 'free';
  return status === 'trialing' || status === 'active' || status === 'past_due' ? plan : 'free';
}

export async function getSubscription(tx: Tx, tenantId: string): Promise<SubscriptionDto> {
  const row = await tx.maybeOne<SubscriptionRow>(
    `SELECT s.plan, s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end, t.stripe_customer_id
     FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id WHERE t.id = $1`,
    [tenantId],
  );
  if (!row || !row.plan) {
    return {
      plan: 'free',
      effectivePlan: 'free',
      status: 'none',
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      hasStripeCustomer: Boolean(row?.stripe_customer_id),
    };
  }
  return {
    plan: row.plan,
    effectivePlan: effectivePlan(row.plan, row.status),
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    hasStripeCustomer: Boolean(row.stripe_customer_id),
  };
}

async function currentCount(
  tx: Tx,
  tenantId: string,
  metric: Metric,
  period: string,
): Promise<number> {
  switch (metric) {
    case 'clients': {
      const [r] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clients WHERE tenant_id = $1 AND archived_at IS NULL`,
        [tenantId],
      );
      return r?.n ?? 0;
    }
    case 'members': {
      const [r] = await tx.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM memberships WHERE tenant_id = $1)::int
              + (SELECT count(*) FROM invites WHERE tenant_id = $1 AND accepted_at IS NULL AND expires_at > now())::int AS n`,
        [tenantId],
      );
      return r?.n ?? 0;
    }
    default: {
      const [r] = await tx.query<{ n: number }>(
        `SELECT count FROM usage_counters WHERE tenant_id = $1 AND period = $2 AND metric = $3`,
        [tenantId, period, metric],
      );
      return r ? Number((r as unknown as { count: number }).count) : 0;
    }
  }
}

export async function getUsage(tx: Tx, tenantId: string, plan: PlanId): Promise<UsageDto> {
  const period = currentPeriod();
  const limits = PLANS[plan].limits;
  const metrics = {} as UsageDto['metrics'];
  for (const metric of Object.keys(limits) as Metric[]) {
    metrics[metric] = {
      used: await currentCount(tx, tenantId, metric, period),
      limit: limits[metric],
    };
  }
  return { period, metrics };
}

/**
 * Server-side plan enforcement. Call inside the same transaction as the write it guards.
 *  - monthly metrics: atomically increments the counter (UPSERT ... RETURNING) and throws if the
 *    new value exceeds the limit — the throw rolls the increment back with the transaction.
 *  - total metrics: takes a per-(tenant, metric) advisory lock so two concurrent inserts cannot both
 *    pass the check, then counts live rows.
 */
export async function assertWithinLimit(tx: Tx, tenantId: string, metric: Metric): Promise<void> {
  const sub = await getSubscription(tx, tenantId);
  const plan = sub.effectivePlan;
  const limit = PLANS[plan].limits[metric];
  const period = currentPeriod();

  if (METRIC_KIND[metric] === 'monthly') {
    const [row] = await tx.query<{ count: number }>(
      `INSERT INTO usage_counters (tenant_id, period, metric, count) VALUES ($1, $2, $3, 1)
       ON CONFLICT (tenant_id, period, metric) DO UPDATE SET count = usage_counters.count + 1
       RETURNING count`,
      [tenantId, period, metric],
    );
    const count = Number(row?.count ?? 0);
    if (limit !== null && count > limit) throw new PlanLimitError(metric, limit, count - 1, plan);
    return;
  }

  await tx.execute(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${tenantId}:${metric}`]);
  const current = await currentCount(tx, tenantId, metric, period);
  if (limit !== null && current >= limit) throw new PlanLimitError(metric, limit, current, plan);
}
