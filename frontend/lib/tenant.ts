import 'server-only';
import type { MeDto } from '@duenudge/shared';
import { serverApi } from './api-server';

/** Server helper: the current tenant's currency (for list pages that show aggregates). */
export async function getTenantCurrency(): Promise<string> {
  const me = await serverApi<MeDto>('/api/v1/auth/me');
  return me.tenant.currency;
}
