import Link from 'next/link';
import type { ClientDto, Paginated } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { money } from '@/lib/format';
import { getTenantCurrency } from '@/lib/tenant';
import {
  Card,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata = { title: 'Clients' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({
    page: sp.page ?? '1',
    ...(sp.q ? { q: sp.q } : {}),
    ...(sp.archived ? { includeArchived: 'true' } : {}),
  });
  const [data, currency] = await Promise.all([
    serverApi<Paginated<ClientDto>>(`/api/v1/clients?${qs}`),
    getTenantCurrency(),
  ]);
  return (
    <>
      <PageHeader
        title="Clients"
        description={`${data.total} client${data.total === 1 ? '' : 's'}`}
        action={<LinkButton href="/app/clients/new">New client</LinkButton>}
      />
      <Card>
        <form className="mb-4 flex gap-2" action="/app/clients">
          <Input
            name="q"
            placeholder="Search name, email or company"
            defaultValue={sp.q ?? ''}
            className="max-w-sm"
          />
          <label className="flex items-center gap-1.5 text-sm text-ink-500">
            <input
              type="checkbox"
              name="archived"
              value="1"
              defaultChecked={Boolean(sp.archived)}
            />{' '}
            Show archived
          </label>
        </form>
        {data.items.length === 0 ? (
          <EmptyState
            title="No clients yet"
            body="Add a client to start invoicing them."
            action={<LinkButton href="/app/clients/new">New client</LinkButton>}
          />
        ) : (
          <Table
            head={
              <>
                <Th>Client</Th>
                <Th>Invoices</Th>
                <Th>Avg. days to pay</Th>
                <Th className="text-right">Outstanding</Th>
                <Th className="text-right">Overdue</Th>
              </>
            }
          >
            {data.items.map((c) => (
              <tr key={c.id} className={c.archivedAt ? 'opacity-50' : 'hover:bg-ink-50'}>
                <Td>
                  <Link href={`/app/clients/${c.id}`} className="font-medium text-brand-700">
                    {c.name}
                  </Link>
                  <span className="block text-xs text-ink-500">
                    {c.company ? `${c.company} · ` : ''}
                    {c.email}
                  </span>
                </Td>
                <Td>{c.invoiceCount}</Td>
                <Td>{c.avgDaysToPay ?? '—'}</Td>
                <Td className="text-right tabular-nums">{money(c.outstandingCents, currency)}</Td>
                <Td
                  className={
                    c.overdueCents > 0
                      ? 'text-right tabular-nums text-red-600'
                      : 'text-right tabular-nums'
                  }
                >
                  {money(c.overdueCents, currency)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          hrefFor={(p) => `/app/clients?${new URLSearchParams({ ...sp, page: String(p) })}`}
        />
      </Card>
    </>
  );
}
