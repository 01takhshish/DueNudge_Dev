'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import {
  REMINDER_TONES,
  type AiDraftDto,
  type InvoiceDto,
  type ReminderTone,
} from '@duenudge/shared';
import { api, ApiError } from '@/lib/api-client';
import { dateTime, money, todayIso } from '@/lib/format';
import { useMe } from '@/components/me-context';
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from '@/components/ui';

const OPEN = ['sent', 'viewed', 'overdue'];

export function InvoiceActions({ invoice }: { invoice: InvoiceDto }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  async function act(name: string, fn: () => Promise<unknown>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(name);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  const recordPayment = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = f.get('amount') ? Math.round(Number(f.get('amount')) * 100) : undefined;
    void act('pay', () =>
      api
        .post(`/api/v1/invoices/${invoice.id}/payments`, {
          amountCents: amount,
          paidAt: f.get('paidAt'),
          method: f.get('method'),
          note: f.get('note') || null,
        })
        .then(() => setPaying(false)),
    );
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {invoice.status === 'draft' && (
          <>
            <Button
              variant="danger"
              onClick={() =>
                void act(
                  'delete',
                  () =>
                    api
                      .del(`/api/v1/invoices/${invoice.id}`)
                      .then(() => router.push('/app/invoices')),
                  'Delete this draft?',
                )
              }
              loading={busy === 'delete'}
            >
              Delete
            </Button>
            <Button
              onClick={() =>
                void act(
                  'send',
                  () => api.post(`/api/v1/invoices/${invoice.id}/send`),
                  `Email this invoice to the client and schedule reminders?`,
                )
              }
              loading={busy === 'send'}
            >
              Send invoice
            </Button>
          </>
        )}
        {OPEN.includes(invoice.status) && (
          <>
            <Button
              variant="secondary"
              onClick={() =>
                void act(
                  'void',
                  () => api.post(`/api/v1/invoices/${invoice.id}/void`),
                  'Void this invoice? Pending reminders will be cancelled.',
                )
              }
              loading={busy === 'void'}
            >
              Void
            </Button>
            <Button onClick={() => setPaying((p) => !p)}>Record payment</Button>
          </>
        )}
        {invoice.publicUrl && (
          <a
            href={invoice.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg border border-ink-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-ink-100"
          >
            View as client
          </a>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {paying && (
        <form
          onSubmit={recordPayment}
          className="grid w-full max-w-lg grid-cols-2 gap-3 rounded-xl border border-ink-300/60 bg-white p-4 text-left shadow-sm sm:grid-cols-4"
        >
          <Field label={`Amount (${invoice.currency})`} hint="Blank = full balance">
            <Input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder={((invoice.totalCents - invoice.amountPaidCents) / 100).toFixed(2)}
            />
          </Field>
          <Field label="Date">
            <Input name="paidAt" type="date" defaultValue={todayIso()} required />
          </Field>
          <Field label="Method">
            <Select name="method" defaultValue="bank_transfer">
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
              <option value="paypal">PayPal</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Note">
            <Input name="note" placeholder="Ref #" />
          </Field>
          <div className="col-span-2 flex justify-end gap-2 sm:col-span-4">
            <Button type="button" variant="ghost" onClick={() => setPaying(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy === 'pay'}>
              Save payment
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ReminderPanel({ invoice }: { invoice: InvoiceDto }) {
  const router = useRouter();
  const me = useMe();
  const [tone, setTone] = useState<ReminderTone>(
    invoice.status === 'overdue' ? 'firm' : 'friendly',
  );
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(
    invoice.drafts[0] ? { subject: invoice.drafts[0].subject, body: invoice.drafts[0].body } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const isOpen = OPEN.includes(invoice.status);
  const aiQuota = me.usage.metrics.ai_drafts;
  const aiAvailable = aiQuota.limit === null || aiQuota.used < aiQuota.limit;

  async function generate() {
    setBusy('ai');
    setMsg(null);
    try {
      const d = await api.post<AiDraftDto>(`/api/v1/invoices/${invoice.id}/ai-draft`, { tone });
      setDraft({ subject: d.subject, body: d.body });
    } catch (err) {
      if (err instanceof ApiError && err.code !== 'PLAN_LIMIT_REACHED')
        setMsg({ tone: 'error', text: err.message });
    } finally {
      setBusy(null);
    }
  }
  async function sendNow() {
    if (!draft) return;
    setBusy('send');
    setMsg(null);
    try {
      await api.post(`/api/v1/invoices/${invoice.id}/reminders/send-now`, draft);
      setMsg({ tone: 'success', text: 'Reminder queued — it will be delivered within a minute.' });
      setDraft(null);
      router.refresh();
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof ApiError ? err.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  }
  async function cancel(reminderId: string) {
    await api.del(`/api/v1/invoices/${invoice.id}/reminders/${reminderId}`);
    router.refresh();
  }

  return (
    <>
      <Card title="Reminders">
        {invoice.reminders.length === 0 ? (
          <p className="text-sm text-ink-500">No reminders.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {invoice.reminders.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2">
                <div>
                  <span className="capitalize">{r.kind.replace('_', ' ')}</span>
                  {r.offsetDays !== null && (
                    <span className="text-ink-500">
                      {' '}
                      ({r.offsetDays > 0 ? `+${r.offsetDays}` : r.offsetDays}d)
                    </span>
                  )}
                  <span className="block text-xs text-ink-500">
                    {r.status === 'sent' ? `Sent ${dateTime(r.sentAt)}` : dateTime(r.scheduledFor)}
                    {r.lastError && r.status !== 'sent' ? ` · ${r.lastError}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={r.status} />
                  {r.status === 'pending' && (
                    <button
                      className="text-xs text-ink-500 underline"
                      onClick={() => void cancel(r.id)}
                    >
                      cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {isOpen && (
        <Card title="Send a nudge now" action={<Sparkles size={16} className="text-brand-600" />}>
          {msg && (
            <div className="mb-3">
              <Alert tone={msg.tone}>{msg.text}</Alert>
            </div>
          )}
          <div className="flex gap-2">
            <Select value={tone} onChange={(e) => setTone(e.target.value as ReminderTone)}>
              {REMINDER_TONES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() => void generate()}
              loading={busy === 'ai'}
              title={aiAvailable ? 'Draft with AI' : 'AI drafts are not included in your plan'}
            >
              <Sparkles size={14} /> Draft with AI
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink-500">
            {aiQuota.limit === null
              ? 'Unlimited AI drafts'
              : `${aiQuota.used}/${aiQuota.limit} AI drafts used this month`}{' '}
            · balance {money(invoice.totalCents - invoice.amountPaidCents, invoice.currency)}
          </p>
          <div className="mt-3 space-y-3">
            <Field label="Subject">
              <Input
                value={draft?.subject ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ subject: e.target.value, body: d?.body ?? '' }))
                }
                placeholder="Write your own, or draft with AI"
              />
            </Field>
            <Field
              label="Message"
              hint="A “View invoice” button and any payment link are appended automatically."
            >
              <Textarea
                rows={8}
                value={draft?.body ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ subject: d?.subject ?? '', body: e.target.value }))
                }
              />
            </Field>
            <Button
              className="w-full"
              onClick={() => void sendNow()}
              disabled={!draft?.subject || !draft?.body}
              loading={busy === 'send'}
            >
              Send reminder to {invoice.clientEmail}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
