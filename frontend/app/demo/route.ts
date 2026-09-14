import { NextResponse, type NextRequest } from 'next/server';
import { isDemoMode, DEMO_COOKIE } from '@/lib/demo';

/** "Try the live demo" → instant session in the demo workspace. */
export function GET(req: NextRequest) {
  if (!isDemoMode()) return NextResponse.redirect(new URL('/signup', req.url));
  const res = NextResponse.redirect(new URL('/app', req.url));
  const secure = process.env.NODE_ENV === 'production';
  const base = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
  res.cookies.set('dn_access', 'demo', { ...base, maxAge: 86_400 });
  res.cookies.set('dn_refresh', 'demo', { ...base, maxAge: 30 * 86_400 });
  if (!req.cookies.has(DEMO_COOKIE))
    res.cookies.set(DEMO_COOKIE, crypto.randomUUID(), { ...base, maxAge: 30 * 86_400 });
  return res;
}
