import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { MeDto } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { date } from '@/lib/format';
import { Badge, Card, Input, PageHeader, Pagination, Stat, Table, Td, Th } from '@/components/ui';
import { SuspendButton } from '@/components/admin-actions';

export const metadata = { title: 'Platform admin' };

interface Overview {
  tenants: number;
  users: number;
  invoices: number;
  invoices_30d: number;
  reminders_sent_30d: number;
  emails_failed_7d: number;
  byPlan: Array<{ plan: string; status: string; n: number }>;
  mrrUsd: number;
  aiCostUsd30d: number;
}
interface TenantRow {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  suspendedAt: string | null;
  onboardedAt: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  ownerEmail: string | null;
  members: number;
  invoices: number;
  clients: number;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const me = await serverApi<MeDto>('/api/v1/auth/me');
  if (!me.user.isPlatformAdmin) redirect('/app');
  const sp = await searchParams;
  const qs = new URLSearchParams({
    page: sp.page ?? '1',
    pageSize: '25',
    ...(sp.q ? { q: sp.q } : {}),
  });
  const [o, tenants] = await Promise.all([
    serverApi<Overview>('/api/v1/admin/overview'),
    serverApi<{ items: TenantRow[]; page: number; pageSize: number; total: number }>(
      `/api/v1/admin/tenants?${qs}`,
    ),
  ]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title="Platform admin"
        description="Cross-tenant view. Every action here is audited."
        action={
          <Link href="/app" className="text-sm text-brand-600 underline">
            Back to app
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tenants" value={String(o.tenants)} sub={`${o.users} users`} />
        <Stat
          label="MRR (active)"
          value={`$${o.mrrUsd}`}
          sub={o.byPlan.map((b) => `${b.plan}/${b.status}: ${b.n}`).join(' · ')}
        />
        <Stat
          label="Invoices (30d)"
          value={String(o.invoices_30d)}
          sub={`${o.invoices} all time · ${o.reminders_sent_30d} reminders sent`}
        />
        <Stat
          label="AI cost (30d)"
          value={`$${o.aiCostUsd30d.toFixed(2)}`}
          sub={`${o.emails_failed_7d} failed emails (7d)`}
          tone={o.emails_failed_7d > 0 ? 'danger' : undefined}
        />
      </div>
      <Card className="mt-6" title="Tenants">
        <form className="mb-4" action="/admin">
          <Input
            name="q"
            placeholder="Search name, slug or owner email"
            defaultValue={sp.q ?? ''}
            className="max-w-sm"
          />
        </form>
        <Table
          head={
            <>
              <Th>Tenant</Th>
              <Th>Owner</Th>
              <Th>Plan</Th>
              <Th>Members</Th>
              <Th>Clients</Th>
              <Th>Invoices</Th>
              <Th>Created</Th>
              <Th />
            </>
          }
        >
          {tenants.items.map((t) => (
            <tr key={t.id} className={t.suspendedAt ? 'bg-red-50/50' : ''}>
              <Td>
                <span className="font-medium">{t.name}</span>
                <span className="block text-xs text-ink-500">
                  {t.slug}
                  {!t.onboardedAt && ' · not onboarded'}
                </span>
              </Td>
              <Td className="text-ink-500">{t.ownerEmail}</Td>
              <Td>
                <Badge value={t.plan ?? 'free'} />{' '}
                <span className="text-xs text-ink-500">{t.subscriptionStatus}</span>
              </Td>
              <Td>{t.members}</Td>
              <Td>{t.clients}</Td>
              <Td>{t.invoices}</Td>
              <Td className="text-ink-500">{date(t.createdAt)}</Td>
              <Td className="text-right">
                <SuspendButton id={t.id} suspended={Boolean(t.suspendedAt)} />
              </Td>
            </tr>
          ))}
        </Table>
        <Pagination
          page={tenants.page}
          pageSize={tenants.pageSize}
          total={tenants.total}
          hrefFor={(p) => `/admin?${new URLSearchParams({ ...sp, page: String(p) })}`}
        />
      </Card>
    </main>
  );
}
