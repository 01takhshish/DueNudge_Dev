import type { MeDto } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { Card, PageHeader } from '@/components/ui';
import { WorkspaceForm } from '@/components/workspace-form';

export const metadata = { title: 'Workspace settings' };

export default async function SettingsPage() {
  const me = await serverApi<MeDto>('/api/v1/auth/me');
  const canEdit = me.role !== 'member';
  return (
    <>
      <PageHeader
        title="Workspace"
        description="Business details shown on invoices, and the reminder schedule."
      />
      <Card>
        {canEdit ? (
          <WorkspaceForm tenant={me.tenant} />
        ) : (
          <p className="text-sm text-ink-500">
            Only owners and admins can change workspace settings.
          </p>
        )}
      </Card>
    </>
  );
}
