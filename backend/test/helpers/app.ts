import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Never touch Redis/BullMQ from API tests: capture enqueued jobs instead.
export const enqueued: Array<{ type: string; data: unknown }> = [];
vi.mock('../../src/jobs/queues.js', () => ({
  enqueueSendEmail: async (data: unknown) => void enqueued.push({ type: 'email', data }),
  enqueueSendReminder: async (data: unknown) => void enqueued.push({ type: 'reminder', data }),
  redisConnection: () => ({
    status: 'ready',
    ping: async () => 'PONG',
    connect: async () => undefined,
  }),
  closeQueues: async () => undefined,
  ensureSchedulers: async () => undefined,
  QUEUES: { email: 'email', reminders: 'reminders', maintenance: 'maintenance' },
  JOBS: {},
}));

export async function makeApp(): Promise<FastifyInstance> {
  const { buildApp } = await import('../../src/app.js');
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Extracts cookies from a response into a Cookie header value. */
export function cookieHeader(
  res: { cookies: Array<{ name: string; value: string }> },
  previous = '',
): string {
  const jar = new Map<string, string>();
  for (const part of previous
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [k, v] = part.split('=');
    if (k) jar.set(k, v ?? '');
  }
  for (const c of res.cookies) jar.set(c.name, c.value);
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export interface Session {
  cookie: string;
  tenantId: string;
  userId: string;
}

export async function signup(
  app: FastifyInstance,
  email: string,
  opts: { name?: string; tenantName?: string; inviteToken?: string } = {},
): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email,
      password: 'Password123!',
      name: opts.name ?? 'Test User',
      tenantName: opts.tenantName,
      inviteToken: opts.inviteToken,
    },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const me = res.json();
  return { cookie: cookieHeader(res), tenantId: me.tenant.id, userId: me.user.id };
}

export async function createClient(
  app: FastifyInstance,
  s: Session,
  overrides: Record<string, unknown> = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/clients',
    headers: { cookie: s.cookie },
    payload: {
      name: 'Client Co',
      email: `client-${Math.random().toString(36).slice(2)}@example.com`,
      ...overrides,
    },
  });
  return res;
}

export function todayPlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function createInvoice(
  app: FastifyInstance,
  s: Session,
  clientId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/invoices',
    headers: { cookie: s.cookie },
    payload: {
      clientId,
      issueDate: todayPlus(0),
      dueDate: todayPlus(14),
      items: [{ description: 'Work', quantity: 2, unitCents: 10000 }],
      ...overrides,
    },
  });
}
