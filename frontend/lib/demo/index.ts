/**
 * Demo mode: the frontend runs with NO backend. An in-memory mock of the API serves realistic data so
 * every screen works on a static host like Vercel. Enable with NEXT_PUBLIC_DEMO_MODE=true.
 */
export const isDemoMode = () => process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
export const DEMO_COOKIE = 'dn_demo';
