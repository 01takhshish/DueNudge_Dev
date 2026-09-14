'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui';

export function ArchiveClientButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function archive() {
    if (!confirm('Archive this client? Their invoices are kept.')) return;
    setLoading(true);
    try {
      await api.del(`/api/v1/clients/${id}`);
      router.push('/app/clients');
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed');
      setLoading(false);
    }
  }
  return (
    <Button variant="secondary" onClick={() => void archive()} loading={loading}>
      Archive
    </Button>
  );
}
