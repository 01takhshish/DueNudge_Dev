'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TenantDto } from '@duenudge/shared';
import { api, ApiError } from '@/lib/api-client';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'JPY'];

export function WorkspaceForm({ tenant }: { tenant: TenantDto }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState(tenant.logoUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const f = new FormData(e.currentTarget);
    const offsets = String(f.get('reminderOffsets'))
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    try {
      await api.patch('/api/v1/tenant', {
        name: f.get('name'),
        currency: f.get('currency'),
        timezone: f.get('timezone'),
        businessEmail: f.get('businessEmail') || null,
        businessAddress: f.get('businessAddress') || null,
        defaultPaymentTermsDays: Number(f.get('defaultPaymentTermsDays')),
        reminderOffsets: offsets,
        logoUrl,
      });
      setMsg({ tone: 'success', text: 'Saved.' });
      router.refresh();
    } catch (err) {
      setMsg({
        tone: 'error',
        text:
          err instanceof ApiError
            ? err.validation[0]
              ? `${err.validation[0].path}: ${err.validation[0].message}`
              : err.message
            : 'Failed',
      });
    } finally {
      setLoading(false);
    }
  }

  async function uploadLogo(file: File) {
    setMsg(null);
    try {
      const { uploadUrl, publicUrl } = await api.post<{ uploadUrl: string; publicUrl: string }>(
        '/api/v1/tenant/logo-upload',
        { contentType: file.type, sizeBytes: file.size },
      );
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type },
      });
      if (!put.ok) throw new Error('Upload failed');
      setLogoUrl(publicUrl);
      setMsg({ tone: 'success', text: 'Logo uploaded — click Save to apply.' });
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof ApiError ? err.message : 'Upload failed' });
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      {msg && (
        <div className="sm:col-span-2">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <Field label="Business name">
        <Input name="name" defaultValue={tenant.name} required />
      </Field>
      <Field label="Billing email">
        <Input name="businessEmail" type="email" defaultValue={tenant.businessEmail ?? ''} />
      </Field>
      <Field label="Currency" hint="Applies to new invoices">
        <Select name="currency" defaultValue={tenant.currency}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Timezone" hint="Reminders are sent at 9:00 AM in this timezone">
        <Input name="timezone" defaultValue={tenant.timezone} required />
      </Field>
      <Field label="Default payment terms (days)">
        <Input
          name="defaultPaymentTermsDays"
          type="number"
          min={0}
          max={120}
          defaultValue={tenant.defaultPaymentTermsDays}
        />
      </Field>
      <Field
        label="Reminder schedule"
        hint="Days relative to the due date, comma-separated. Negative = before due. e.g. -3, 0, 3, 7, 14"
      >
        <Input name="reminderOffsets" defaultValue={tenant.reminderOffsets.join(', ')} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Address">
          <Textarea name="businessAddress" defaultValue={tenant.businessAddress ?? ''} rows={2} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Logo" hint="PNG, JPG, WebP or SVG up to 2 MB. Shown on public invoice pages.">
          <div className="flex items-center gap-3">
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Logo"
                className="h-10 w-10 rounded-md border border-ink-300/60 object-contain"
              />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="text-sm"
              onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])}
            />
            {logoUrl && (
              <button
                type="button"
                className="text-xs text-ink-500 underline"
                onClick={() => setLogoUrl(null)}
              >
                Remove
              </button>
            )}
          </div>
        </Field>
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" loading={loading}>
          Save
        </Button>
      </div>
    </form>
  );
}
