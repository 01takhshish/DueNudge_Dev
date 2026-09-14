import type { MeDto, TeamDto } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { PageHeader } from '@/components/ui';
import { TeamManager } from '@/components/team-manager';

export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const [team, me] = await Promise.all([
    serverApi<TeamDto>('/api/v1/team'),
    serverApi<MeDto>('/api/v1/auth/me'),
  ]);
  const m = me.usage.metrics.members;
  return (
    <>
      <PageHeader
        title="Team"
        description={`${m.used} of ${m.limit ?? '∞'} seats used (members + pending invites)`}
      />
      <TeamManager team={team} />
    </>
  );
}
