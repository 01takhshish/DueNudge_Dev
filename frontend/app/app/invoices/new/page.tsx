import type { ClientDto, MeDto, Paginated } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { InvoiceForm } from '@/components/invoice-form';

export const metadata = { title: 'New invoice' };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const { clientId } = await searchParams;
  const [clients, me] = await Promise.all([
    serverApi<Paginated<ClientDto>>('/api/v1/clients?pageSize=100'),
    serverApi<MeDto>('/api/v1/auth/me'),
  ]);
  return (
    <>
      <PageHeader
        title="New invoice"
        description="Saved as a draft. Nothing is sent until you click Send."
      />
      <Card>
        {clients.items.length === 0 ? (
          <EmptyState
            title="Add a client first"
            body="Invoices are addressed to a client."
            action={<LinkButton href="/app/clients/new">New client</LinkButton>}
          />
        ) : (
          <InvoiceForm
            clients={clients.items}
            currency={me.tenant.currency}
            defaultClientId={clientId}
          />
        )}
      </Card>
    </>
  );
}
