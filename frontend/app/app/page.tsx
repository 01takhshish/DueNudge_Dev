import Link from 'next/link';
import type { DashboardDto, InvoiceSummaryDto, Paginated } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { date, dateTime, humanAction, money } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const [d, recent] = await Promise.all([
    serverApi<DashboardDto>('/api/v1/dashboard/summary'),
    serverApi<Paginated<InvoiceSummaryDto>>('/api/v1/invoices?pageSize=8'),
  ]);
  return (
    <>
      <PageHeader
        title="Dashboard"
        action={<LinkButton href="/app/invoices/new">New invoice</LinkButton>}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Outstanding"
          value={money(d.outstandingCents, d.currency)}
          sub="Sent, viewed or overdue"
        />
        <Stat
          label="Overdue"
          value={money(d.overdueCents, d.currency)}
          sub={`${d.overdueCount} invoice${d.overdueCount === 1 ? '' : 's'}`}
          tone={d.overdueCents > 0 ? 'danger' : undefined}
        />
        <Stat
          label="Collected this month"
          value={money(d.paidThisMonthCents, d.currency)}
          tone="success"
        />
        <Stat label="Drafts" value={String(d.draftCount)} sub="Not yet sent" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Recent invoices"
          className="lg:col-span-2"
          action={
            <Link href="/app/invoices" className="text-xs text-brand-600 underline">
              View all
            </Link>
          }
        >
          {recent.items.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              body="Create your first invoice and we’ll take care of the reminders."
              action={<LinkButton href="/app/invoices/new">New invoice</LinkButton>}
            />
          ) : (
            <Table
              head={
                <>
                  <Th>Invoice</Th>
                  <Th>Client</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Total</Th>
                </>
              }
            >
              {recent.items.map((i) => (
                <tr key={i.id} className="hover:bg-ink-50">
                  <Td>
                    <Link href={`/app/invoices/${i.id}`} className="font-medium text-brand-700">
                      {i.number}
                    </Link>
                  </Td>
                  <Td>{i.clientName}</Td>
                  <Td>{date(i.dueDate)}</Td>
                  <Td>
                    <Badge value={i.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{money(i.totalCents, i.currency)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Upcoming reminders (7 days)">
            {d.upcomingReminders.length === 0 ? (
              <p className="text-sm text-ink-500">
                Nothing scheduled. Reminders are created automatically when you send an invoice.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.upcomingReminders.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span>
                      <Link
                        href={`/app/invoices/${r.invoiceId}`}
                        className="font-medium text-brand-700"
                      >
                        {r.invoiceNumber}
                      </Link>
                      <span className="text-ink-500"> · {r.clientName}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-500">
                      {dateTime(r.scheduledFor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Activity">
            <ul className="space-y-2 text-sm">
              {d.recentActivity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span className="truncate">
                    {humanAction(a.action)}
                    {typeof a.metadata.number === 'string' && (
                      <span className="text-ink-500"> · {a.metadata.number}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-ink-500">{dateTime(a.createdAt)}</span>
                </li>
              ))}
              {d.recentActivity.length === 0 && <li className="text-ink-500">No activity yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
