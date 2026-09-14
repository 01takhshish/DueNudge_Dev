import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ClientDto, InvoiceSummaryDto, Paginated } from '@duenudge/shared';
import { serverApi, serverApiOrNull } from '@/lib/api-server';
import { date, money } from '@/lib/format';
import { getTenantCurrency } from '@/lib/tenant';
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
import { ClientForm } from '@/components/client-form';
import { ArchiveClientButton } from '@/components/client-actions';

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await serverApiOrNull<ClientDto>(`/api/v1/clients/${id}`);
  if (!client) notFound();
  const [invoices, currency] = await Promise.all([
    serverApi<Paginated<InvoiceSummaryDto>>(`/api/v1/invoices?clientId=${id}&pageSize=50`),
    getTenantCurrency(),
  ]);
  return (
    <>
      <PageHeader
        title={client.name}
        description={[client.company, client.email].filter(Boolean).join(' · ')}
        action={
          <div className="flex gap-2">
            {!client.archivedAt && <ArchiveClientButton id={client.id} />}
            <LinkButton href={`/app/invoices/new?clientId=${client.id}`}>New invoice</LinkButton>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Outstanding" value={money(client.outstandingCents, currency)} />
        <Stat
          label="Overdue"
          value={money(client.overdueCents, currency)}
          tone={client.overdueCents > 0 ? 'danger' : undefined}
        />
        <Stat
          label="Avg. days to pay"
          value={client.avgDaysToPay === null ? '—' : String(client.avgDaysToPay)}
          sub={`${client.invoiceCount} invoices · terms ${client.paymentTermsDays}d`}
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card title="Invoices" className="lg:col-span-3">
          {invoices.items.length === 0 ? (
            <EmptyState title="No invoices for this client" />
          ) : (
            <Table
              head={
                <>
                  <Th>Invoice</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Total</Th>
                </>
              }
            >
              {invoices.items.map((i) => (
                <tr key={i.id} className="hover:bg-ink-50">
                  <Td>
                    <Link href={`/app/invoices/${i.id}`} className="font-medium text-brand-700">
                      {i.number}
                    </Link>
                  </Td>
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
        <Card title="Details" className="lg:col-span-2">
          {client.archivedAt ? (
            <p className="text-sm text-ink-500">This client is archived.</p>
          ) : (
            <ClientForm client={client} />
          )}
        </Card>
      </div>
    </>
  );
}
