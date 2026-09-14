'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';

export function SuspendButton({ id, suspended }: { id: string; suspended: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function toggle() {
    if (
      !confirm(
        suspended
          ? 'Restore access for this tenant?'
          : 'Suspend this tenant? All their sessions will be revoked.',
      )
    )
      return;
    setLoading(true);
    try {
      await api.post(`/api/v1/admin/tenants/${id}/${suspended ? 'unsuspend' : 'suspend'}`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      onClick={() => void toggle()}
      disabled={loading}
      className={
        suspended ? 'text-xs text-emerald-700 underline' : 'text-xs text-red-600 underline'
      }
    >
      {suspended ? 'Unsuspend' : 'Suspend'}
    </button>
  );
}
