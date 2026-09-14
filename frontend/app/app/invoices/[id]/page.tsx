import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ClientDto, InvoiceDto, Paginated } from '@duenudge/shared';
import { serverApi, serverApiOrNull } from '@/lib/api-server';
import { date, dateTime, money } from '@/lib/format';
import { Badge, Card, PageHeader, Table, Td, Th } from '@/components/ui';
import { InvoiceForm } from '@/components/invoice-form';
import { InvoiceActions, ReminderPanel } from '@/components/invoice-actions';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await serverApiOrNull<InvoiceDto>(`/api/v1/invoices/${id}`);
  if (!inv) notFound();
  const balance = inv.totalCents - inv.amountPaidCents;

  if (inv.status === 'draft') {
    const clients = await serverApi<Paginated<ClientDto>>('/api/v1/clients?pageSize=100');
    return (
      <>
        <PageHeader
          title={`${inv.number} · Draft`}
          description="Edit freely — nothing has been sent yet."
          action={<InvoiceActions invoice={inv} />}
        />
        <Card>
          <InvoiceForm clients={clients.items} currency={inv.currency} invoice={inv} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={inv.number}
        description={
          <>
            <Link href={`/app/clients/${inv.clientId}`} className="text-brand-700 underline">
              {inv.clientName}
            </Link>{' '}
            · issued {date(inv.issueDate)} · due {date(inv.dueDate)}
          </>
        }
        action={<InvoiceActions invoice={inv} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Invoice" action={<Badge value={inv.status} />}>
            <Table
              head={
                <>
                  <Th>Description</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Unit</Th>
                  <Th className="text-right">Amount</Th>
                </>
              }
            >
              {inv.items.map((i) => (
                <tr key={i.id}>
                  <Td>{i.description}</Td>
                  <Td className="text-right tabular-nums">{i.quantity}</Td>
                  <Td className="text-right tabular-nums">{money(i.unitCents, inv.currency)}</Td>
                  <Td className="text-right tabular-nums">{money(i.amountCents, inv.currency)}</Td>
                </tr>
              ))}
            </Table>
            <dl className="ml-auto mt-4 w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal</dt>
                <dd className="tabular-nums">{money(inv.subtotalCents, inv.currency)}</dd>
              </div>
              {inv.taxCents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-500">Tax ({inv.taxRateBps / 100}%)</dt>
                  <dd className="tabular-nums">{money(inv.taxCents, inv.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(inv.totalCents, inv.currency)}</dd>
              </div>
              {inv.amountPaidCents > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <dt>Paid</dt>
                  <dd className="tabular-nums">−{money(inv.amountPaidCents, inv.currency)}</dd>
                </div>
              )}
              {inv.status !== 'paid' && inv.status !== 'void' && (
                <div className="flex justify-between border-t border-ink-100 pt-1 font-semibold">
                  <dt>Balance due</dt>
                  <dd className="tabular-nums">{money(balance, inv.currency)}</dd>
                </div>
              )}
            </dl>
            {inv.notes && (
              <p className="mt-4 whitespace-pre-line rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
                {inv.notes}
              </p>
            )}
            <p className="mt-4 text-xs text-ink-500">
              Public link:{' '}
              {inv.publicUrl ? (
                <a
                  href={inv.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-700 underline"
                >
                  {inv.publicUrl}
                </a>
              ) : (
                '—'
              )}
              {inv.viewedAt && <> · first viewed {dateTime(inv.viewedAt)}</>}
            </p>
          </Card>
          {inv.payments.length > 0 && (
            <Card title="Payments">
              <Table
                head={
                  <>
                    <Th>Date</Th>
                    <Th>Method</Th>
                    <Th>Note</Th>
                    <Th className="text-right">Amount</Th>
                  </>
                }
              >
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <Td>{date(p.paidAt)}</Td>
                    <Td className="capitalize">{p.method.replace('_', ' ')}</Td>
                    <Td className="text-ink-500">{p.note ?? '—'}</Td>
                    <Td className="text-right tabular-nums">
                      {money(p.amountCents, inv.currency)}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <ReminderPanel invoice={inv} />
        </div>
      </div>
    </>
  );
}
