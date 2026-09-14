import type { BillingDto } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { PageHeader } from '@/components/ui';
import { BillingPanel } from '@/components/billing-panel';

export const metadata = { title: 'Billing' };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; upgrade?: string }>;
}) {
  const sp = await searchParams;
  const billing = await serverApi<BillingDto>('/api/v1/billing');
  return (
    <>
      <PageHeader
        title="Plan & billing"
        description="Limits are enforced by the server; this page just shows where you stand."
      />
      <BillingPanel billing={billing} checkoutResult={sp.checkout} highlight={sp.upgrade} />
    </>
  );
}
