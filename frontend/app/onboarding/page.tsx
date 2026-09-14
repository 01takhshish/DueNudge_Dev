import { redirect } from 'next/navigation';
import type { MeDto } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { OnboardingWizard } from '@/components/onboarding-wizard';

export const metadata = { title: 'Get set up' };

export default async function OnboardingPage() {
  const me = await serverApi<MeDto>('/api/v1/auth/me');
  if (me.tenant.onboardedAt) redirect('/app');
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-sm font-medium text-brand-600">Welcome, {me.user.name.split(' ')[0]}</p>
      <h1 className="mt-1 text-2xl font-semibold">Let&apos;s get {me.tenant.name} ready</h1>
      <p className="mt-1 text-sm text-ink-500">
        Three quick steps. You can change all of this later in Settings.
      </p>
      <div className="mt-8">
        <OnboardingWizard tenant={me.tenant} />
      </div>
    </main>
  );
}
