'use client';
import type { ApiErrorBody } from '@duenudge/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: ApiErrorBody['error'],
  ) {
    super(message);
  }
  get validation(): Array<{ path: string; message: string }> {
    return (this.body?.details as Array<{ path: string; message: string }> | undefined) ?? [];
  }
}

export const PLAN_LIMIT_EVENT = 'duenudge:plan-limit';

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

/**
 * Browser fetch wrapper. Same-origin (/api is rewritten to the API), cookies included.
 *  - 401: refresh once and retry, else redirect to login
 *  - 402 PLAN_LIMIT_REACHED: broadcast so the UpgradeModal opens, then throw
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried && !path.includes('/auth/')) {
    if (await tryRefresh()) return request<T>(method, path, body, true);
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!res.ok) {
    const err = json?.error;
    if (err?.code === 'PLAN_LIMIT_REACHED')
      window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: err }));
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
