'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientDto } from '@duenudge/shared';
import { api, ApiError } from '@/lib/api-client';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui';

export function ClientForm({ client }: { client?: ClientDto }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get('name'),
      email: f.get('email'),
      company: f.get('company') || null,
      phone: f.get('phone') || null,
      address: f.get('address') || null,
      notes: f.get('notes') || null,
      paymentTermsDays: Number(f.get('paymentTermsDays')),
    };
    try {
      const saved = client
        ? await api.patch<ClientDto>(`/api/v1/clients/${client.id}`, body)
        : await api.post<ClientDto>('/api/v1/clients', body);
      router.push(`/app/clients/${saved.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(err.validation.map((v) => [v.path, v.message])));
        if (err.code !== 'PLAN_LIMIT_REACHED') setError(err.message);
      } else setError('Something went wrong');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      {error && (
        <div className="sm:col-span-2">
          <Alert>{error}</Alert>
        </div>
      )}
      <Field label="Contact name" error={errors.name}>
        <Input name="name" required defaultValue={client?.name} />
      </Field>
      <Field label="Email" error={errors.email} hint="Invoices and reminders are sent here">
        <Input name="email" type="email" required defaultValue={client?.email} />
      </Field>
      <Field label="Company" error={errors.company}>
        <Input name="company" defaultValue={client?.company ?? ''} />
      </Field>
      <Field label="Phone" error={errors.phone}>
        <Input name="phone" defaultValue={client?.phone ?? ''} />
      </Field>
      <Field label="Payment terms (days)" hint="Default due date = issue date + terms">
        <Input
          name="paymentTermsDays"
          type="number"
          min={0}
          max={120}
          defaultValue={client?.paymentTermsDays ?? 14}
        />
      </Field>
      <Field label="Address">
        <Input name="address" defaultValue={client?.address ?? ''} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Private notes">
          <Textarea name="notes" defaultValue={client?.notes ?? ''} />
        </Field>
      </div>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {client ? 'Save changes' : 'Create client'}
        </Button>
      </div>
    </form>
  );
}
