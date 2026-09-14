'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS, PLAN_IDS, type BillingDto, type Metric } from '@duenudge/shared';
import { api, ApiError } from '@/lib/api-client';
import { date } from '@/lib/format';
import { useMe } from '@/components/me-context';
import { Alert, Badge, Button, Card } from '@/components/ui';

const LABEL: Record<Metric, string> = {
  clients: 'Clients',
  invoices: 'Invoices this month',
  members: 'Team seats',
  ai_drafts: 'AI drafts this month',
};

export function BillingPanel({
  billing,
  checkoutResult,
  highlight,
}: {
  billing: BillingDto;
  checkoutResult?: string;
  highlight?: string;
}) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(
    checkoutResult === 'success'
      ? {
          tone: 'success',
          text: 'Subscription started. Your plan updates as soon as Stripe confirms (usually seconds).',
        }
      : checkoutResult === 'cancelled'
        ? { tone: 'info', text: 'Checkout cancelled — no changes made.' }
        : null,
  );
  const sub = billing.subscription;
  const isOwner = me.role === 'owner';
  const hasActiveSub = sub.status !== 'none' && sub.status !== 'canceled' && sub.plan !== 'free';

  async function go(name: string, fn: () => Promise<{ url?: string | null; pending?: boolean }>) {
    setBusy(name);
    setMsg(null);
    try {
      const r = await fn();
      if (r.url) window.location.href = r.url;
      else {
        setMsg({
          tone: 'success',
          text: 'Plan change requested. It will apply as soon as Stripe confirms.',
        });
        router.refresh();
      }
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof ApiError ? err.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Current plan" className="lg:col-span-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold">{PLANS[sub.effectivePlan].name}</span>
            <Badge value={sub.status === 'none' ? 'free' : sub.status} />
          </div>
          {sub.status === 'trialing' && sub.trialEndsAt && (
            <p className="mt-1 text-sm text-ink-500">Trial ends {date(sub.trialEndsAt)}</p>
          )}
          {sub.cancelAtPeriodEnd && sub.currentPeriodEnd && (
            <p className="mt-1 text-sm text-red-600">Cancels on {date(sub.currentPeriodEnd)}</p>
          )}
          {!sub.cancelAtPeriodEnd && sub.currentPeriodEnd && sub.status !== 'trialing' && (
            <p className="mt-1 text-sm text-ink-500">Renews {date(sub.currentPeriodEnd)}</p>
          )}
          {sub.hasStripeCustomer && isOwner && (
            <Button
              variant="secondary"
              className="mt-4 w-full"
              loading={busy === 'portal'}
              onClick={() => void go('portal', () => api.post('/api/v1/billing/portal'))}
            >
              Manage card & invoices
            </Button>
          )}
          {!isOwner && (
            <p className="mt-3 text-xs text-ink-500">
              Only the workspace owner can change billing.
            </p>
          )}
        </Card>
        <Card title="Usage" className="lg:col-span-2">
          <ul className="space-y-3">
            {(Object.keys(billing.usage.metrics) as Metric[]).map((m) => {
              const u = billing.usage.metrics[m];
              const pct =
                u.limit === null
                  ? 0
                  : Math.min(100, Math.round((u.used / Math.max(u.limit, 1)) * 100));
              return (
                <li key={m}>
                  <div className="flex justify-between text-sm">
                    <span>{LABEL[m]}</span>
                    <span className="tabular-nums text-ink-500">
                      {u.used} / {u.limit ?? '∞'}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-ink-100">
                    <div
                      className={
                        pct >= 100
                          ? 'h-1.5 rounded-full bg-red-500'
                          : 'h-1.5 rounded-full bg-brand-500'
                      }
                      style={{ width: `${u.limit === null ? 8 : pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const current = sub.effectivePlan === id && (id === 'free' ? !hasActiveSub : true);
          const isHighlight = highlight === id;
          return (
            <div
              key={id}
              className={
                isHighlight
                  ? 'rounded-2xl border-2 border-brand-500 bg-white p-5'
                  : 'rounded-2xl border border-ink-300/60 bg-white p-5'
              }
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                {current && <Badge value="active" />}
              </div>
              <p className="mt-2 text-2xl font-semibold">
                ${p.priceMonthlyUsd}
                <span className="text-sm font-normal text-ink-500">/mo</span>
              </p>
              <ul className="mt-3 space-y-1 text-sm text-ink-700">
                {p.features.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              {isOwner && !current && (
                <Button
                  className="mt-4 w-full"
                  variant={id === 'free' ? 'secondary' : 'primary'}
                  loading={busy === id}
                  onClick={() =>
                    void go(id, () =>
                      hasActiveSub
                        ? api.post('/api/v1/billing/change-plan', { plan: id })
                        : api.post('/api/v1/billing/checkout', { plan: id }),
                    )
                  }
                >
                  {id === 'free'
                    ? 'Downgrade at period end'
                    : hasActiveSub
                      ? `Switch to ${p.name} (prorated)`
                      : `Start ${p.name}${sub.hasStripeCustomer ? '' : ' — 14-day trial'}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-500">
        Payments are processed by Stripe. Upgrades are prorated immediately; downgrades take effect
        at the end of the billing period. A failed payment keeps your features while Stripe retries,
        then reverts to Free.
      </p>
    </div>
  );
}
