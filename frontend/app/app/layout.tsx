import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { MeDto } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { MeProvider } from '@/components/me-context';
import { AppShell } from '@/components/app-shell';
import { UpgradeModal } from '@/components/upgrade-modal';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await serverApi<MeDto>('/api/v1/auth/me');
  if (!me.tenant.onboardedAt) redirect('/onboarding');
  return (
    <MeProvider me={me}>
      <AppShell>{children}</AppShell>
      <UpgradeModal />
    </MeProvider>
  );
}
