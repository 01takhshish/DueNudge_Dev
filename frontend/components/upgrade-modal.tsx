'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PLANS, type Metric, type PlanId } from '@duenudge/shared';
import { PLAN_LIMIT_EVENT } from '@/lib/api-client';
import { Button, LinkButton } from '@/components/ui';

interface Limit {
  metric: Metric;
  limit: number;
  current: number;
  plan: PlanId;
}
const LABEL: Record<Metric, string> = {
  clients: 'clients',
  invoices: 'invoices this month',
  members: 'team members',
  ai_drafts: 'AI drafts this month',
};

/** Opens whenever any API call returns 402 PLAN_LIMIT_REACHED. The graceful upgrade prompt. */
export function UpgradeModal() {
  const [limit, setLimit] = useState<Limit | null>(null);
  useEffect(() => {
    const handler = (e: Event) => setLimit((e as CustomEvent<{ limit: Limit }>).detail.limit);
    window.addEventListener(PLAN_LIMIT_EVENT, handler);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, handler);
  }, []);
  if (!limit) return null;
  const next: PlanId = limit.plan === 'free' ? 'pro' : 'business';
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4"
      role="dialog"
      aria-modal
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
          Plan limit reached
        </p>
        <h2 className="mt-1 text-lg font-semibold">
          You&apos;ve used {limit.current} of {limit.limit} {LABEL[limit.metric]}
        </h2>
        <p className="mt-2 text-sm text-ink-500">
          The {PLANS[limit.plan].name} plan includes {limit.limit} {LABEL[limit.metric]}.{' '}
          {PLANS[next].name} gives you{' '}
          {PLANS[next].limits[limit.metric] === null
            ? 'unlimited'
            : PLANS[next].limits[limit.metric]}{' '}
          — ${PLANS[next].priceMonthlyUsd}/month, with a 14-day trial.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setLimit(null)}>
            Not now
          </Button>
          <LinkButton href={`/app/settings/billing?upgrade=${next}`}>See plans</LinkButton>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Only the workspace owner can change the plan.{' '}
          <Link href="/app/settings/team" className="underline">
            See team
          </Link>
        </p>
      </div>
    </div>
  );
}
