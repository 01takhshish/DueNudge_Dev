'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { ClientDto, InvoiceDto } from '@duenudge/shared';
import { api, ApiError } from '@/lib/api-client';
import { money, todayIso } from '@/lib/format';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';

interface Line {
  description: string;
  quantity: string;
  unit: string;
}
const emptyLine = (): Line => ({ description: '', quantity: '1', unit: '' });
const toCents = (v: string) => Math.round(Number(v || 0) * 100);

export function InvoiceForm({
  clients,
  currency,
  invoice,
  defaultClientId,
}: {
  clients: ClientDto[];
  currency: string;
  invoice?: InvoiceDto;
  defaultClientId?: string;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(
    invoice?.clientId ?? defaultClientId ?? clients[0]?.id ?? '',
  );
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? todayIso());
  const client = clients.find((c) => c.id === clientId);
  const [dueDate, setDueDate] = useState(
    invoice?.dueDate ?? todayIso(client?.paymentTermsDays ?? 14),
  );
  const [taxRate, setTaxRate] = useState(invoice ? String(invoice.taxRateBps / 100) : '0');
  const [lines, setLines] = useState<Line[]>(
    invoice
      ? invoice.items.map((i) => ({
          description: i.description,
          quantity: String(i.quantity),
          unit: (i.unitCents / 100).toFixed(2),
        }))
      : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totals = useMemo(() => {
    const subtotal = lines.reduce(
      (s, l) => s + Math.round(Number(l.quantity || 0) * toCents(l.unit)),
      0,
    );
    const tax = Math.round((subtotal * Math.round(Number(taxRate || 0) * 100)) / 10_000);
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, taxRate]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const body = {
      clientId,
      issueDate,
      dueDate,
      taxRateBps: Math.round(Number(taxRate || 0) * 100),
      notes: f.get('notes') || null,
      paymentLink: f.get('paymentLink') || null,
      items: lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unitCents: toCents(l.unit),
        })),
    };
    try {
      const saved = invoice
        ? await api.put<InvoiceDto>(`/api/v1/invoices/${invoice.id}`, body)
        : await api.post<InvoiceDto>('/api/v1/invoices', body);
      router.push(`/app/invoices/${saved.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code !== 'PLAN_LIMIT_REACHED')
          setError(
            err.validation.length
              ? err.validation.map((v) => `${v.path}: ${v.message}`).join(' · ')
              : err.message,
          );
      } else setError('Something went wrong');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Client">
          <Select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              const c = clients.find((x) => x.id === e.target.value);
              if (c && !invoice) setDueDate(todayIso(c.paymentTermsDays));
            }}
            required
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Issue date">
          <Input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Due date">
          <Input
            type="date"
            value={dueDate}
            min={issueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </Field>
      </div>

      <div>
        <div className="mb-2 grid grid-cols-12 gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
          <span className="col-span-6">Description</span>
          <span className="col-span-2">Qty</span>
          <span className="col-span-2">Unit ({currency})</span>
          <span className="col-span-2 text-right">Amount</span>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <Input
                className="col-span-6"
                placeholder="Design work — homepage"
                value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
                required
              />
              <Input
                className="col-span-2"
                type="number"
                min="0.01"
                step="0.01"
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
                required
              />
              <Input
                className="col-span-2"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={l.unit}
                onChange={(e) => setLine(i, { unit: e.target.value })}
                required
              />
              <span className="col-span-1 text-right text-sm tabular-nums">
                {money(Math.round(Number(l.quantity || 0) * toCents(l.unit)), currency)}
              </span>
              <button
                type="button"
                className="col-span-1 text-ink-500 hover:text-red-600 disabled:opacity-30"
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                disabled={lines.length === 1}
                aria-label="Remove line"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="mt-2"
          onClick={() => setLines((ls) => [...ls, emptyLine()])}
        >
          <Plus size={14} /> Add line
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-4">
          <Field
            label="Payment link (optional)"
            hint="Stripe Payment Link, PayPal.me, etc. Shown as “Pay online”."
          >
            <Input
              name="paymentLink"
              type="url"
              defaultValue={invoice?.paymentLink ?? ''}
              placeholder="https://"
            />
          </Field>
          <Field label="Notes to client">
            <Textarea
              name="notes"
              defaultValue={invoice?.notes ?? ''}
              placeholder="Bank details, thank-you note…"
            />
          </Field>
        </div>
        <div className="space-y-2 rounded-xl bg-ink-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-500">Subtotal</span>
            <span className="tabular-nums">{money(totals.subtotal, currency)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-500">Tax %</span>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className="w-24"
            />
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Tax</span>
            <span className="tabular-nums">{money(totals.tax, currency)}</span>
          </div>
          <div className="flex justify-between border-t border-ink-300/60 pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(totals.total, currency)}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {invoice ? 'Save draft' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}
