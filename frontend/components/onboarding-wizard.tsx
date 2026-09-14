'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientDto, TenantDto } from '@duenudge/shared';
import { api, ApiError } from '@/lib/api-client';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'];
const OFFSET_PRESETS: Array<[string, number[]]> = [
  ['Gentle (3 days before, due day, 7 days after)', [-3, 0, 7]],
  ['Standard (3 before, due, 3 / 7 / 14 after)', [-3, 0, 3, 7, 14]],
  ['Persistent (due, then every 3 days for two weeks)', [0, 3, 6, 9, 12, 15]],
];

export function OnboardingWizard({ tenant }: { tenant: TenantDto }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [client, setClient] = useState<ClientDto | null>(null);
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  async function run(fn: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const saveBusiness = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await api.patch('/api/v1/tenant', {
        name: f.get('name'),
        currency: f.get('currency'),
        timezone: f.get('timezone'),
        businessEmail: f.get('businessEmail') || null,
        businessAddress: f.get('businessAddress') || null,
        defaultPaymentTermsDays: Number(f.get('terms')),
      });
      setStep(1);
    });
  };

  const saveClient = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      const c = await api.post<ClientDto>('/api/v1/clients', {
        name: f.get('name'),
        email: f.get('email'),
        company: f.get('company') || null,
      });
      setClient(c);
      setStep(2);
    });
  };

  const saveSchedule = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await api.patch('/api/v1/tenant', { reminderOffsets: JSON.parse(String(f.get('offsets'))) });
      await api.post('/api/v1/tenant/onboarding/complete');
      router.push(client ? `/app/invoices/new?clientId=${client.id}` : '/app');
      router.refresh();
    });
  };

  const steps = ['Your business', 'First client', 'Reminder schedule'];
  return (
    <div className="space-y-6">
      <ol className="flex gap-4 text-sm">
        {steps.map((s, i) => (
          <li
            key={s}
            className={
              i === step
                ? 'font-semibold text-brand-600'
                : i < step
                  ? 'text-emerald-600'
                  : 'text-ink-500'
            }
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {error && <Alert>{error}</Alert>}

      {step === 0 && (
        <Card title="Your business">
          <form onSubmit={saveBusiness} className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name">
              <Input name="name" defaultValue={tenant.name} required />
            </Field>
            <Field label="Billing email" hint="Shown on invoices">
              <Input name="businessEmail" type="email" defaultValue={tenant.businessEmail ?? ''} />
            </Field>
            <Field label="Currency">
              <Select name="currency" defaultValue={tenant.currency}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Timezone" hint="Reminders go out at 9:00 AM here">
              <Input
                name="timezone"
                defaultValue={tenant.timezone === 'UTC' ? tz : tenant.timezone}
                required
              />
            </Field>
            <Field label="Default payment terms (days)">
              <Input
                name="terms"
                type="number"
                min={0}
                max={120}
                defaultValue={tenant.defaultPaymentTermsDays}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address (optional)">
                <Input name="businessAddress" defaultValue={tenant.businessAddress ?? ''} />
              </Field>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" loading={loading}>
                Continue
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === 1 && (
        <Card title="Add your first client">
          <form onSubmit={saveClient} className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact name">
              <Input name="name" required placeholder="Priya Patel" />
            </Field>
            <Field label="Email" hint="Invoices and reminders go here">
              <Input name="email" type="email" required placeholder="ap@client.com" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Company (optional)">
                <Input name="company" placeholder="Client Co" />
              </Field>
            </div>
            <div className="sm:col-span-2 flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep(2)}>
                Skip for now
              </Button>
              <Button type="submit" loading={loading}>
                Continue
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === 2 && (
        <Card title="How persistent should reminders be?">
          <form onSubmit={saveSchedule} className="space-y-3">
            {OFFSET_PRESETS.map(([label, offsets], i) => (
              <label
                key={label}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-300/60 p-3 hover:bg-ink-50"
              >
                <input
                  type="radio"
                  name="offsets"
                  value={JSON.stringify(offsets)}
                  defaultChecked={i === 1}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-ink-500">
                    Offsets relative to the due date:{' '}
                    {offsets.map((o) => (o > 0 ? `+${o}` : o)).join(', ')} days. Reminders stop
                    automatically when the invoice is paid.
                  </span>
                </span>
              </label>
            ))}
            <div className="flex justify-end pt-2">
              <Button type="submit" loading={loading}>
                {client ? 'Finish & create first invoice' : 'Finish'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
