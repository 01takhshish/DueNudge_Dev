'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { Alert, Button } from '@/components/ui';

export function AcceptInvite({
  token,
  invite,
}: {
  token: string;
  invite: { email: string; role: string; tenantName: string };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function accept() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/v1/auth/invites/${token}/accept`);
      router.push('/app');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
      setLoading(false);
    }
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Join {invite.tenantName}</h1>
      <p className="text-sm text-ink-500">
        You&apos;ve been invited as <strong>{invite.role}</strong>. This invitation is for{' '}
        <strong>{invite.email}</strong> — you must be signed in with that email.
      </p>
      {error && <Alert>{error}</Alert>}
      <Button className="w-full" onClick={() => void accept()} loading={loading}>
        Accept invitation
      </Button>
    </div>
  );
}
