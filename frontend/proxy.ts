import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const ACCESS = 'dn_access';
const REFRESH = 'dn_refresh';
const PROTECTED = ['/app', '/onboarding', '/admin'];
const AUTH_PAGES = ['/login', '/signup'];

/**
 * Edge auth gate. It never verifies JWTs (that is the API's job); it only:
 *  1. silently refreshes an expired access cookie using the refresh cookie, so server components
 *     render with a valid session and the user never sees a login flash;
 *  2. redirects to /login when there is no session at all;
 *  3. bounces logged-in users away from /login and /signup.
 */
export default async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasAccess = req.cookies.has(ACCESS);
  const hasRefresh = req.cookies.has(REFRESH);
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthPage = AUTH_PAGES.includes(pathname);

  if (isAuthPage && hasAccess) return NextResponse.redirect(new URL('/app', req.url));
  if (!isProtected) return NextResponse.next();
  if (hasAccess) return NextResponse.next();

  if (hasRefresh) {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { cookie: `${REFRESH}=${req.cookies.get(REFRESH)!.value}` },
      });
      if (res.ok) {
        const setCookies = res.headers.getSetCookie?.() ?? [];
        const jar = new Map(req.cookies.getAll().map((c) => [c.name, c.value]));
        for (const sc of setCookies) {
          const [pair] = sc.split(';');
          const idx = pair!.indexOf('=');
          jar.set(pair!.slice(0, idx), pair!.slice(idx + 1));
        }
        const headers = new Headers(req.headers);
        headers.set('cookie', [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
        const next = NextResponse.next({ request: { headers } });
        for (const sc of setCookies) next.headers.append('set-cookie', sc);
        return next;
      }
    } catch {
      /* fall through to login */
    }
  }
  const login = new URL('/login', req.url);
  login.searchParams.set('next', pathname + search);
  const redirect = NextResponse.redirect(login);
  redirect.cookies.delete(ACCESS);
  redirect.cookies.delete(REFRESH);
  return redirect;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|i/).*)'],
};
