'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { MeDto } from '@duenudge/shared';

const MeContext = createContext<MeDto | null>(null);
export const MeProvider = ({ me, children }: { me: MeDto; children: ReactNode }) => (
  <MeContext.Provider value={me}>{children}</MeContext.Provider>
);
export function useMe(): MeDto {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside MeProvider');
  return me;
}
