import { Card, PageHeader } from '@/components/ui';
import { ClientForm } from '@/components/client-form';

export const metadata = { title: 'New client' };

export default function NewClientPage() {
  return (
    <>
      <PageHeader title="New client" />
      <Card>
        <ClientForm />
      </Card>
    </>
  );
}
