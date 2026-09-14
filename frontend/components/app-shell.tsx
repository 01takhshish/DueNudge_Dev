'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  CreditCard,
  ShieldCheck,
  LogOut,
  ScrollText,
  Building2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PLANS } from '@duenudge/shared';
import { api } from '@/lib/api-client';
import { useMe } from '@/components/me-context';
import { Badge } from '@/components/ui';
import { Logo } from '@/components/logo';

const nav = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/app/invoices', label: 'Invoices', icon: FileText },
  { href: '/app/clients', label: 'Clients', icon: Users },
  { href: '/app/settings', label: 'Workspace', icon: Settings, exact: true },
  { href: '/app/settings/team', label: 'Team', icon: Building2 },
  { href: '/app/settings/billing', label: 'Billing', icon: CreditCard },
  { href: '/app/settings/audit', label: 'Audit log', icon: ScrollText, minRole: 'admin' as const },
];

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const rank = { member: 0, admin: 1, owner: 2 }[me.role];

  async function logout() {
    await api.post('/api/v1/auth/logout');
    router.push('/login');
    router.refresh();
  }
  async function switchTenant(tenantId: string) {
    await api.post('/api/v1/auth/switch-tenant', { tenantId });
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-ink-300/60 bg-white md:flex">
        <div className="px-5 py-5">
          <Link href="/app" aria-label="Dashboard">
            <Logo />
          </Link>
          {me.memberships.length > 1 ? (
            <select
              className="mt-3 w-full rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-sm"
              value={me.tenant.id}
              onChange={(e) => void switchTenant(e.target.value)}
              aria-label="Switch workspace"
            >
              {me.memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.tenantName}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-2 truncate text-sm text-ink-500">{me.tenant.name}</p>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav
            .filter((n) => !n.minRole || rank >= 1)
            .map((n) => {
              const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={clsx(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                    active
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : 'text-ink-700 hover:bg-ink-100',
                  )}
                >
                  <n.icon size={16} /> {n.label}
                </Link>
              );
            })}
          {me.user.isPlatformAdmin && (
            <Link
              href="/admin"
              className={clsx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                pathname.startsWith('/admin')
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-ink-700 hover:bg-ink-100',
              )}
            >
              <ShieldCheck size={16} /> Platform admin
            </Link>
          )}
        </nav>
        <div className="border-t border-ink-100 px-5 py-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="truncate font-medium">{me.user.name}</span>
            <Badge value={me.subscription.effectivePlan} />
          </div>
          <p className="truncate text-xs text-ink-500">
            {me.user.email} · {me.role}
          </p>
          {me.subscription.effectivePlan === 'free' && (
            <Link
              href="/app/settings/billing"
              className="mt-2 block text-xs text-brand-600 underline"
            >
              Upgrade to {PLANS.pro.name}
            </Link>
          )}
          <button
            onClick={() => void logout()}
            className="mt-3 flex items-center gap-2 text-xs text-ink-500 hover:text-ink-900"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center justify-between border-b border-ink-300/60 bg-white px-4 py-3 md:hidden">
          <Link href="/app" className="font-semibold">
            Due<span className="text-brand-600">Nudge</span>
          </Link>
          <nav className="flex gap-3 text-sm">
            <Link href="/app/invoices">Invoices</Link>
            <Link href="/app/clients">Clients</Link>
            <Link href="/app/settings">Settings</Link>
          </nav>
        </header>
        {process.env.NEXT_PUBLIC_DEMO_MODE === 'true' && (
          <div className="no-print bg-brand-600 px-4 py-1.5 text-center text-xs text-white">
            Demo workspace — explore freely. Changes are yours alone, nothing is emailed, and data
            resets now and then.
          </div>
        )}
        {me.subscription.status === 'past_due' && (
          <div className="no-print bg-red-600 px-4 py-2 text-center text-sm text-white">
            Your last payment failed.{' '}
            <Link href="/app/settings/billing" className="underline">
              Update your card
            </Link>{' '}
            to keep your {PLANS[me.subscription.plan].name} features.
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
