import Link from 'next/link';
import { INVOICE_STATUSES, type InvoiceSummaryDto, type Paginated } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { date, money } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata = { title: 'Invoices' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({
    page: sp.page ?? '1',
    ...(sp.q ? { q: sp.q } : {}),
    ...(sp.status ? { status: sp.status } : {}),
  });
  const data = await serverApi<Paginated<InvoiceSummaryDto>>(`/api/v1/invoices?${qs}`);
  return (
    <>
      <PageHeader
        title="Invoices"
        description={`${data.total} invoice${data.total === 1 ? '' : 's'}`}
        action={<LinkButton href="/app/invoices/new">New invoice</LinkButton>}
      />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2" action="/app/invoices">
          <Input
            name="q"
            placeholder="Search number or client"
            defaultValue={sp.q ?? ''}
            className="max-w-xs"
          />
          <Select name="status" defaultValue={sp.status ?? ''} className="w-40">
            <option value="">All statuses</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <button className="rounded-lg border border-ink-300 px-3 text-sm hover:bg-ink-100">
            Filter
          </button>
        </form>
        {data.items.length === 0 ? (
          <EmptyState
            title="No invoices match"
            action={<LinkButton href="/app/invoices/new">New invoice</LinkButton>}
          />
        ) : (
          <Table
            head={
              <>
                <Th>Invoice</Th>
                <Th>Client</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance</Th>
              </>
            }
          >
            {data.items.map((i) => (
              <tr key={i.id} className="hover:bg-ink-50">
                <Td>
                  <Link href={`/app/invoices/${i.id}`} className="font-medium text-brand-700">
                    {i.number}
                  </Link>
                </Td>
                <Td>{i.clientName}</Td>
                <Td>{date(i.issueDate)}</Td>
                <Td className={i.status === 'overdue' ? 'text-red-600' : ''}>{date(i.dueDate)}</Td>
                <Td>
                  <Badge value={i.status} />
                </Td>
                <Td className="text-right tabular-nums">{money(i.totalCents, i.currency)}</Td>
                <Td className="text-right tabular-nums">
                  {i.status === 'paid' || i.status === 'void'
                    ? '—'
                    : money(i.totalCents - i.amountPaidCents, i.currency)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          hrefFor={(p) => `/app/invoices?${new URLSearchParams({ ...sp, page: String(p) })}`}
        />
      </Card>
    </>
  );
}
