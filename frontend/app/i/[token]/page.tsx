import { notFound } from 'next/navigation';
import type { PublicInvoiceDto } from '@duenudge/shared';
import { date, money } from '@/lib/format';
import { publicApi } from '@/lib/api-server';
import { Badge } from '@/components/ui';
import { PrintButton } from '@/components/print-button';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return { title: `Invoice · ${token.slice(0, 6)}`, robots: { index: false, follow: false } };
}

/** Public, unauthenticated invoice page. Print-friendly (Cmd+P = PDF). */
export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const inv = await publicApi<PublicInvoiceDto>(
    `/api/v1/public/invoices/${encodeURIComponent(token)}`,
  );
  if (!inv) notFound();
  const balance = inv.totalCents - inv.amountPaidCents;
  const open = inv.status !== 'paid' && inv.status !== 'void';

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 print:py-0">
      <div className="rounded-2xl border border-ink-300/60 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6">
          <div>
            {inv.business.logoUrl && (
              <img src={inv.business.logoUrl} alt="" className="mb-3 h-12 object-contain" />
            )}
            <h1 className="text-xl font-semibold">{inv.business.name}</h1>
            {inv.business.email && <p className="text-sm text-ink-500">{inv.business.email}</p>}
            {inv.business.address && (
              <p className="whitespace-pre-line text-sm text-ink-500">{inv.business.address}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Invoice</p>
            <p className="text-2xl font-semibold">{inv.number}</p>
            <div className="mt-1">
              <Badge
                value={inv.status === 'viewed' || inv.status === 'sent' ? 'sent' : inv.status}
              />
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Billed to</p>
            <p className="mt-1 font-medium">{inv.client.company ?? inv.client.name}</p>
            {inv.client.company && <p className="text-sm text-ink-500">{inv.client.name}</p>}
            {inv.client.address && (
              <p className="whitespace-pre-line text-sm text-ink-500">{inv.client.address}</p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:col-span-2 sm:justify-self-end">
            <dt className="text-ink-500">Issue date</dt>
            <dd>{date(inv.issueDate)}</dd>
            <dt className="text-ink-500">Due date</dt>
            <dd className={inv.status === 'overdue' ? 'font-medium text-red-600' : ''}>
              {date(inv.dueDate)}
            </dd>
            <dt className="text-ink-500">Amount due</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {money(open ? balance : 0, inv.currency)}
            </dd>
          </dl>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead className="border-b border-ink-300/60 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {inv.items.map((i) => (
              <tr key={i.id}>
                <td className="py-2.5">{i.description}</td>
                <td className="py-2.5 text-right tabular-nums">{i.quantity}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {money(i.unitCents, inv.currency)}
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {money(i.amountCents, inv.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <div className="flex justify-between border-t border-ink-300/60 pt-1 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(inv.totalCents, inv.currency)}</dd>
          </div>
          {inv.amountPaidCents > 0 && (
            <div className="flex justify-between text-emerald-700">
              <dt>Paid</dt>
              <dd className="tabular-nums">−{money(inv.amountPaidCents, inv.currency)}</dd>
            </div>
          )}
        </dl>
        {inv.notes && (
          <p className="mt-6 whitespace-pre-line rounded-lg bg-ink-50 p-4 text-sm text-ink-700 print:bg-transparent print:p-0">
            {inv.notes}
          </p>
        )}

        {open && (
          <div className="no-print mt-8 flex flex-wrap items-center gap-3 border-t border-ink-100 pt-6">
            {inv.paymentLink && (
              <a
                href={inv.paymentLink}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                target="_blank"
                rel="noreferrer"
              >
                Pay {money(balance, inv.currency)} online
              </a>
            )}
            <PrintButton />
          </div>
        )}
        {inv.status === 'paid' && (
          <p className="mt-8 rounded-lg bg-emerald-50 p-3 text-center text-sm font-medium text-emerald-700">
            Paid — thank you!
          </p>
        )}
      </div>
      <p className="no-print mt-6 text-center text-xs text-ink-500">Sent with DueNudge</p>
    </main>
  );
}
