import { NextResponse, type NextRequest } from 'next/server';
import { isDemoMode, DEMO_COOKIE } from '@/lib/demo';
import { demoHandle } from '@/lib/demo/handler';
import { decodeLog } from '@/lib/demo/log';

/**
 * Same-origin runtime proxy for the API: the browser talks to /api/*, this forwards to API_URL.
 * A route handler (not next.config rewrites) so API_URL is read at *runtime* — one web image works in
 * every environment. httpOnly cookies set by the API pass straight through to the browser.
 *
 * In demo mode (NEXT_PUBLIC_DEMO_MODE=true) there is no backend at all: requests are answered by the
 * in-memory mock in lib/demo, scoped per visitor by the dn_demo cookie.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const HOP_BY_HOP = [
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
];

export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (isDemoMode()) return demo(req, path);

  const target = `${API_URL}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers(req.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: 'manual', // pass OAuth redirects through untouched
    cache: 'no-store',
  });

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.includes(key) && key !== 'set-cookie') out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new NextResponse(upstream.body, { status: upstream.status, headers: out });
}

async function demo(req: NextRequest, path: string[]) {
  const log = decodeLog(req.cookies.get(DEMO_COOKIE)?.value);
  const body =
    req.method === 'GET' || req.method === 'HEAD'
      ? {}
      : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
  const result = demoHandle(
    req.method,
    `/api/${path.join('/')}`,
    req.nextUrl.searchParams,
    body,
    log,
    req.cookies.has('dn_access'),
  );
  const res = NextResponse.json(result.body, { status: result.status });
  const secure = process.env.NODE_ENV === 'production';
  // The visitor's mutation log travels in a cookie — that is the whole "database" of the demo.
  if (result.log !== undefined)
    res.cookies.set(DEMO_COOKIE, result.log, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 30 * 86_400,
    });
  for (const c of result.cookies ?? [])
    res.cookies.set(c.name, c.value, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: c.maxAge,
    });
  return res;
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS,
};
