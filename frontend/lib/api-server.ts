import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ApiErrorBody } from '@duenudge/shared';
import { DEMO_COOKIE, isDemoMode } from './demo';
import { demoHandle } from './demo/handler';
import { decodeLog } from './demo/log';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: ApiErrorBody['error'],
  ) {
    super(message);
  }
}

/**
 * Server-component fetch. Forwards the browser's cookies to the API. A 401 means the session is gone
 * (the proxy already tried to refresh), so we send the user to login. Never cached.
 */
export async function serverApi<T>(
  path: string,
  init: RequestInit & { allow404?: boolean } = {},
): Promise<T> {
  const jar = await cookies();
  if (isDemoMode()) {
    // No backend: answer from the in-memory demo store, scoped to this visitor.
    const [pathname, search = ''] = path.split('?');
    const r = demoHandle(
      init.method ?? 'GET',
      pathname!,
      new URLSearchParams(search),
      {},
      decodeLog(jar.get(DEMO_COOKIE)?.value),
      jar.has('dn_access'),
    );
    if (r.status === 401) redirect(`/login?next=${encodeURIComponent('/app')}`);
    if (r.status >= 400) {
      const body = r.body as ApiErrorBody;
      throw new ApiError(r.status, body.error.code, body.error.message, body.error);
    }
    return r.body as T;
  }
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: cookieHeader, accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 401) redirect(`/login?next=${encodeURIComponent('/app')}`);
  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-json */
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'HTTP_ERROR',
      body?.error?.message ?? `Request failed (${res.status})`,
      body?.error,
    );
  }
  return (await res.json()) as T;
}

/** Like serverApi but returns null on 404 instead of throwing (detail pages -> notFound()). */
export async function serverApiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await serverApi<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Unauthenticated fetch for public pages (invoice links, invitations). */
export async function publicApi<T>(path: string): Promise<T | null> {
  if (isDemoMode()) {
    const jar = await cookies();
    const [pathname, search = ''] = path.split('?');
    const r = demoHandle(
      'GET',
      pathname!,
      new URLSearchParams(search),
      {},
      decodeLog(jar.get(DEMO_COOKIE)?.value),
      false,
    );
    return r.status === 200 ? (r.body as T) : null;
  }
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
  return (await res.json()) as T;
}
