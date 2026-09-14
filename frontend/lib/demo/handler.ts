import {
  PLANS,
  type AiDraftDto,
  type ClientDto,
  type DashboardDto,
  type InvoiceDto,
  type Paginated,
  type PlanId,
  type PublicInvoiceDto,
} from '@duenudge/shared';
import { encodeLog, MAX_ENCODED, type Op } from './log';
import { isoDay, seedState, type DemoState } from './store';

export interface DemoResponse {
  status: number;
  body: unknown;
  cookies?: Array<{ name: string; value: string; maxAge?: number }>;
  /** Present when the request mutated state: the new log to persist (already encoded). */
  log?: string;
}

const ok = (body: unknown, status = 200): DemoResponse => ({ status, body });
const error = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): DemoResponse => ({ status, body: { error: { code, message, requestId: 'demo', ...extra } } });
const SESSION_COOKIES = [
  { name: 'dn_access', value: 'demo', maxAge: 86_400 },
  { name: 'dn_refresh', value: 'demo', maxAge: 30 * 86_400 },
];
const APP_URL = () => process.env.APP_URL ?? '';
const OPEN = ['sent', 'viewed', 'overdue'];
type Inv = DemoState['invoices'][number];
type Body = Record<string, unknown>;

// ─── Replay: every mutation is a pure function of (state, op) ────────────────
function audit(
  s: DemoState,
  t: number,
  action: string,
  entityType: string,
  ref: string,
  actor = s.me.user.name,
) {
  s.audit.unshift({
    id: `a-${s.audit.length}`,
    action,
    entityType,
    entityId: null,
    actorName: actor,
    metadata: { number: ref },
    createdAt: new Date(t).toISOString(),
  });
}

function totals(
  items: Array<{ description: string; quantity: number; unitCents: number }>,
  taxRateBps: number,
  idPrefix: string,
) {
  const lines = items.map((it, k) => ({
    id: `${idPrefix}-l${k}`,
    description: it.description,
    quantity: it.quantity,
    unitCents: it.unitCents,
    amountCents: Math.round(it.quantity * it.unitCents),
  }));
  const subtotalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
  return {
    items: lines,
    subtotalCents,
    taxRateBps,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

function draftFor(s: DemoState, inv: Inv, tone: string, t: number, id: string): AiDraftDto {
  const c = s.clients.find((x) => x.id === inv.clientId)!;
  const balance = `$${((inv.totalCents - inv.amountPaidCents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  const days = Math.round((t - Date.parse(inv.dueDate)) / 86_400_000);
  const first = c.name.split(' ')[0];
  const sent = inv.reminders.filter((r) => r.status === 'sent').length;
  const nth = sent + 1 === 2 ? '2nd' : sent + 1 === 3 ? '3rd' : `${sent + 1}th`;
  const drafts: Record<string, [string, string]> = {
    friendly: [
      `Quick check-in on invoice ${inv.number}`,
      `Hi ${first},\n\nHope the week is going well. I wanted to check in on invoice ${inv.number} for ${balance}${days > 0 ? `, which was due on ${inv.dueDate}` : `, due on ${inv.dueDate}`}. If it's already on its way, please ignore this — otherwise, could you let me know when I can expect it?\n\nThanks so much,\n${s.me.user.name}`,
    ],
    firm: [
      `Invoice ${inv.number} — ${balance} now ${Math.max(days, 0)} days overdue`,
      `Hi ${first},\n\nFollowing up on invoice ${inv.number} for ${balance}, which was due on ${inv.dueDate} and is now ${Math.max(days, 0)} days overdue.${sent ? ` This is the ${nth} reminder.` : ''} Could you confirm a payment date by the end of this week?\n\nIf there's an issue with the invoice, tell me and I'll sort it out right away.\n\nBest,\n${s.me.user.name}`,
    ],
    final_notice: [
      `Final notice: invoice ${inv.number} (${balance})`,
      `Dear ${c.name},\n\nDespite previous reminders, invoice ${inv.number} for ${balance} (due ${inv.dueDate}) remains unpaid, ${Math.max(days, 0)} days past due.\n\nPlease settle the balance within 5 business days. If payment is not received by then, I will pause work on current deliverables and apply the late fee described in our agreement.\n\nI'd much rather resolve this simply — reply to this email if you need anything from me.\n\nRegards,\n${s.me.user.name}\n${s.me.tenant.name}`,
    ],
  };
  const [subject, body] = drafts[tone] ?? drafts.friendly!;
  return { id, tone, subject, body, model: 'demo-template', createdAt: new Date(t).toISOString() };
}

const setPlan = (s: DemoState, plan: PlanId, t: number) => {
  s.me.subscription = {
    ...s.me.subscription,
    plan,
    effectivePlan: plan,
    status: plan === 'free' ? 'canceled' : 'active',
    cancelAtPeriodEnd: false,
  };
  for (const m of Object.keys(PLANS[plan].limits) as Array<keyof typeof PLANS.free.limits>)
    s.me.usage.metrics[m].limit = PLANS[plan].limits[m];
  audit(s, t, 'billing.plan_changed', 'subscription', plan);
};

/** Applies one op. `i` is the op's index in the log — used to mint deterministic ids. */
export function applyOp(s: DemoState, op: Op, i: number): void {
  const [code, t, ...a] = op;
  const now = new Date(t).toISOString();
  const inv = () => s.invoices.find((x) => x.id === a[0]);
  switch (code) {
    case 'su': {
      s.me.user.name = String(a[0]);
      s.members[0]!.name = String(a[0]);
      return;
    }
    case 'tu': {
      Object.assign(s.me.tenant, a[0] as Body);
      audit(s, t, 'tenant.updated', 'tenant', s.me.tenant.name);
      return;
    }
    case 'to': {
      s.me.tenant.onboardedAt ??= now;
      return;
    }
    case 'cc': {
      const b = a[0] as Body;
      s.clients.push({
        id: `c-${i}`,
        name: String(b.name),
        email: String(b.email),
        company: (b.company as string) ?? null,
        phone: (b.phone as string) ?? null,
        address: (b.address as string) ?? null,
        notes: (b.notes as string) ?? null,
        paymentTermsDays: Number(b.paymentTermsDays ?? 14),
        archivedAt: null,
        createdAt: now,
      });
      s.me.usage.metrics.clients.used = s.clients.filter((x) => !x.archivedAt).length;
      audit(s, t, 'client.created', 'client', String(b.name));
      return;
    }
    case 'cu': {
      const c = s.clients.find((x) => x.id === a[0]);
      if (c) {
        Object.assign(c, a[1] as Body);
        audit(s, t, 'client.updated', 'client', c.name);
      }
      return;
    }
    case 'ca': {
      const c = s.clients.find((x) => x.id === a[0]);
      if (c) {
        c.archivedAt = now;
        audit(s, t, 'client.archived', 'client', c.name);
      }
      s.me.usage.metrics.clients.used = s.clients.filter((x) => !x.archivedAt).length;
      return;
    }
    case 'ic': {
      const b = a[0] as Body;
      const id = `i-${i}`;
      const tt = totals(
        b.items as Array<{ description: string; quantity: number; unitCents: number }>,
        Number(b.taxRateBps ?? 0),
        id,
      );
      const number = `INV-${String(++s.counter).padStart(4, '0')}`;
      s.invoices.unshift({
        id,
        number,
        status: 'draft',
        currency: 'USD',
        issueDate: String(b.issueDate),
        dueDate: String(b.dueDate),
        ...tt,
        amountPaidCents: 0,
        clientId: String(b.clientId),
        sentAt: null,
        viewedAt: null,
        paidAt: null,
        createdAt: now,
        notes: (b.notes as string) ?? null,
        paymentLink: (b.paymentLink as string) ?? null,
        publicToken: null,
        payments: [],
        reminders: [],
        drafts: [],
      });
      s.me.usage.metrics.invoices.used += 1;
      audit(s, t, 'invoice.created', 'invoice', number);
      return;
    }
    case 'iu': {
      const x = inv();
      const b = a[1] as Body;
      if (x && x.status === 'draft') {
        Object.assign(x, {
          clientId: b.clientId,
          issueDate: b.issueDate,
          dueDate: b.dueDate,
          notes: b.notes ?? null,
          paymentLink: b.paymentLink ?? null,
          ...totals(
            b.items as Array<{ description: string; quantity: number; unitCents: number }>,
            Number(b.taxRateBps ?? 0),
            x.id,
          ),
        });
        audit(s, t, 'invoice.updated', 'invoice', x.number);
      }
      return;
    }
    case 'id': {
      const x = inv();
      if (x && x.status === 'draft') {
        s.invoices = s.invoices.filter((y) => y.id !== x.id);
        audit(s, t, 'invoice.deleted', 'invoice', x.number);
      }
      return;
    }
    case 'is': {
      const x = inv();
      if (!x || x.status !== 'draft') return;
      x.status = 'sent';
      x.sentAt = now;
      x.publicToken = `demo-${x.number.toLowerCase()}-${i}`;
      x.reminders = s.me.tenant.reminderOffsets
        .map((offset) => {
          const d = new Date(Date.parse(x.dueDate) + offset * 86_400_000);
          d.setUTCHours(13, 0, 0, 0);
          return {
            id: `${x.id}-r${offset}`,
            kind: (offset < 0 ? 'before_due' : offset === 0 ? 'on_due' : 'overdue') as
              'before_due' | 'on_due' | 'overdue',
            offsetDays: offset,
            scheduledFor: d.toISOString(),
            status: 'pending' as const,
            attempts: 0,
            lastError: null,
            sentAt: null,
            subject: null,
          };
        })
        .filter((r) => Date.parse(r.scheduledFor) > t);
      audit(s, t, 'invoice.sent', 'invoice', x.number);
      return;
    }
    case 'pv': {
      const x = inv();
      if (x && x.status === 'sent') {
        x.status = 'viewed';
        x.viewedAt = now;
        audit(s, t, 'invoice.viewed', 'invoice', x.number, null as unknown as string);
      } else if (x && OPEN.includes(x.status)) x.viewedAt ??= now;
      return;
    }
    case 'ip': {
      const x = inv();
      if (!x || !OPEN.includes(x.status)) return;
      const remaining = x.totalCents - x.amountPaidCents;
      const amount = Math.min(Number(a[1] ?? remaining), remaining);
      x.payments.unshift({
        id: `${x.id}-p${x.payments.length}`,
        amountCents: amount,
        paidAt: String(a[2] ?? isoDay(0, t)),
        method: String(a[3] ?? 'bank_transfer'),
        note: (a[4] as string) ?? null,
      });
      x.amountPaidCents += amount;
      if (amount === remaining) {
        x.status = 'paid';
        x.paidAt = now;
        for (const r of x.reminders) if (r.status === 'pending') r.status = 'skipped';
        audit(s, t, 'invoice.paid', 'invoice', x.number);
      } else audit(s, t, 'invoice.partially_paid', 'invoice', x.number);
      return;
    }
    case 'iv': {
      const x = inv();
      if (!x || x.status === 'paid' || x.status === 'void') return;
      x.status = 'void';
      for (const r of x.reminders) if (r.status === 'pending') r.status = 'skipped';
      audit(s, t, 'invoice.voided', 'invoice', x.number);
      return;
    }
    case 'ad': {
      const x = inv();
      if (!x) return;
      x.drafts.unshift(draftFor(s, x, String(a[1]), t, `${x.id}-d${i}`));
      s.me.usage.metrics.ai_drafts.used += 1;
      audit(s, t, 'reminder.ai_drafted', 'invoice', x.number);
      return;
    }
    case 'rs': {
      const x = inv();
      if (!x || !OPEN.includes(x.status)) return;
      x.reminders.push({
        id: `${x.id}-m${i}`,
        kind: 'manual',
        offsetDays: null,
        scheduledFor: now,
        status: 'sent',
        attempts: 1,
        lastError: null,
        sentAt: now,
        subject: String(a[1]),
      });
      audit(s, t, 'reminder.sent', 'invoice', x.number);
      return;
    }
    case 'rc': {
      const r = inv()?.reminders.find((y) => y.id === a[1]);
      if (r && r.status === 'pending') {
        r.status = 'skipped';
        r.lastError = 'cancelled by user';
        audit(s, t, 'reminder.cancelled', 'reminder', inv()!.number);
      }
      return;
    }
    case 'ti': {
      s.invites.push({
        id: `inv-${i}`,
        email: String(a[0]),
        role: a[1] as 'admin' | 'member',
        expiresAt: isoDay(7, t),
        createdAt: now,
      });
      s.me.usage.metrics.members.used = s.members.length + s.invites.length;
      audit(s, t, 'invite.created', 'invite', String(a[0]));
      return;
    }
    case 'tr': {
      s.invites = s.invites.filter((x) => x.id !== a[0]);
      s.me.usage.metrics.members.used = s.members.length + s.invites.length;
      return;
    }
    case 'mr': {
      const m = s.members.find((x) => x.userId === a[0]);
      if (m && m.role !== 'owner') m.role = a[1] as 'admin' | 'member';
      return;
    }
    case 'mx': {
      s.members = s.members.filter((x) => x.userId !== a[0] || x.role === 'owner');
      s.me.usage.metrics.members.used = s.members.length + s.invites.length;
      return;
    }
    case 'bp': {
      setPlan(s, a[0] as PlanId, t);
      return;
    }
  }
}

export function replay(log: Op[]): DemoState {
  const s = seedState();
  log.forEach((op, i) => applyOp(s, op, i));
  return s;
}

// ─── DTO helpers ─────────────────────────────────────────────────────────────
function clientDto(s: DemoState, c: DemoState['clients'][number]): ClientDto {
  const inv = s.invoices.filter((i) => i.clientId === c.id);
  const open = inv.filter((i) => OPEN.includes(i.status));
  const paid = inv.filter((i) => i.status === 'paid');
  const avg = paid.length
    ? Math.round(
        paid.reduce(
          (a, i) => a + (Date.parse(i.paidAt!) - Date.parse(i.issueDate)) / 86_400_000,
          0,
        ) / paid.length,
      )
    : null;
  return {
    ...c,
    outstandingCents: open.reduce((a, i) => a + i.totalCents - i.amountPaidCents, 0),
    overdueCents: open
      .filter((i) => i.status === 'overdue')
      .reduce((a, i) => a + i.totalCents - i.amountPaidCents, 0),
    invoiceCount: inv.filter((i) => i.status !== 'void').length,
    avgDaysToPay: avg,
  };
}
function invoiceDto(s: DemoState, i: Inv): InvoiceDto {
  const c = s.clients.find((x) => x.id === i.clientId)!;
  const { publicToken, ...rest } = i;
  return {
    ...rest,
    clientName: c.name,
    clientEmail: c.email,
    publicUrl: publicToken ? `${APP_URL()}/i/${publicToken}` : null,
  };
}
function paginate<T>(items: T[], q: URLSearchParams): Paginated<T> {
  const page = Number(q.get('page') ?? 1);
  const pageSize = Number(q.get('pageSize') ?? 25);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: items.length,
  };
}

// ─── Request router ──────────────────────────────────────────────────────────
/**
 * Routes the same paths as the real API. Reads answer from replay(log); writes append an op, re-apply it,
 * and hand back the new encoded log for the caller to persist in the visitor's cookie.
 */
export function demoHandle(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Body,
  log: Op[],
  hasSession: boolean,
): DemoResponse {
  const s = replay(log);
  const p = path.replace(/^\/?api\/v1\/?/, '').replace(/\/$/, '');
  const seg = p.split('/');
  const t = Date.now();

  /** Commit a mutation: apply, then return the response with the new log. Resets the log when the cookie would overflow. */
  const commit = (op: Op, respond: (state: DemoState) => DemoResponse): DemoResponse => {
    const next = [...log, op];
    let encoded = encodeLog(next);
    let state = s;
    if (encoded.length > MAX_ENCODED) {
      // Session full: start over from the seed with just this op. The UI banner warns that data resets.
      const fresh = replay([op]);
      state = fresh;
      encoded = encodeLog([op]);
    } else applyOp(state, op, next.length - 1);
    return { ...respond(state), log: encoded };
  };

  // ─── public / auth ───
  if (seg[0] === 'public' && seg[1] === 'invoices' && seg[2]) {
    const inv = s.invoices.find((i) => i.publicToken === seg[2]);
    if (!inv) return error(404, 'NOT_FOUND', 'Invoice not found');
    const c = s.clients.find((x) => x.id === inv.clientId)!;
    const dto = (x: Inv): PublicInvoiceDto => ({
      number: x.number,
      status: x.status,
      currency: x.currency,
      issueDate: x.issueDate,
      dueDate: x.dueDate,
      subtotalCents: x.subtotalCents,
      taxRateBps: x.taxRateBps,
      taxCents: x.taxCents,
      totalCents: x.totalCents,
      amountPaidCents: x.amountPaidCents,
      notes: x.notes,
      paymentLink: x.paymentLink,
      items: x.items,
      business: {
        name: s.me.tenant.name,
        email: s.me.tenant.businessEmail,
        address: s.me.tenant.businessAddress,
        logoUrl: s.me.tenant.logoUrl,
      },
      client: { name: c.name, company: c.company, address: c.address },
    });
    if (inv.status === 'sent' && hasSession)
      return commit(['pv', t, inv.id], (st) => ok(dto(st.invoices.find((i) => i.id === inv.id)!)));
    return ok(dto(inv));
  }
  if (seg[0] === 'auth') {
    if (seg[1] === 'login' || seg[1] === 'signup') {
      const status = seg[1] === 'signup' ? 201 : 200;
      if (seg[1] === 'signup' && typeof body.name === 'string' && body.name)
        return {
          ...commit(['su', t, body.name], (st) => ok(st.me, status)),
          cookies: SESSION_COOKIES,
        };
      return { ...ok(s.me, status), cookies: SESSION_COOKIES };
    }
    if (seg[1] === 'refresh') return { ...ok({ ok: true }), cookies: SESSION_COOKIES };
    if (seg[1] === 'logout')
      return {
        ...ok({ ok: true }),
        cookies: SESSION_COOKIES.map((c) => ({ ...c, value: '', maxAge: 0 })),
      };
    if (seg[1] === 'invites')
      return error(404, 'NOT_FOUND', 'Invitations are not available in the demo');
    if (seg[1] === 'google')
      return error(503, 'OAUTH_NOT_CONFIGURED', 'Google sign-in is not available in the demo');
  }
  if (!hasSession) return error(401, 'UNAUTHORIZED', 'Authentication required');
  if (seg[0] === 'auth' && (seg[1] === 'me' || seg[1] === 'switch-tenant')) return ok(s.me);

  // ─── tenant / team / billing / audit / admin / dashboard ───
  if (seg[0] === 'tenant') {
    if (seg[1] === 'onboarding') return commit(['to', t], (st) => ok(st.me.tenant));
    if (seg[1] === 'logo-upload')
      return error(503, 'STORAGE_NOT_CONFIGURED', 'Logo upload is not available in the demo');
    if (method === 'PATCH') return commit(['tu', t, body], (st) => ok(st.me.tenant));
    return ok(s.me.tenant);
  }
  if (seg[0] === 'team') {
    if (seg[1] === 'invites' && method === 'POST') {
      if (s.members.length + s.invites.length >= (s.me.usage.metrics.members.limit ?? 99))
        return error(
          402,
          'PLAN_LIMIT_REACHED',
          `Your ${s.me.subscription.effectivePlan} plan allows ${s.me.usage.metrics.members.limit} members. Upgrade to continue.`,
          {
            limit: {
              metric: 'members',
              limit: s.me.usage.metrics.members.limit,
              current: s.members.length + s.invites.length,
              plan: s.me.subscription.effectivePlan,
            },
          },
        );
      return commit(['ti', t, String(body.email), (body.role as string) ?? 'member'], (st) =>
        ok(st.invites.at(-1), 201),
      );
    }
    if (seg[1] === 'invites' && method === 'DELETE')
      return commit(['tr', t, seg[2]], () => ok({ ok: true }));
    if (seg[1] === 'members' && seg[2])
      return commit(method === 'DELETE' ? ['mx', t, seg[2]] : ['mr', t, seg[2], body.role], () =>
        ok({ ok: true }),
      );
    return ok({ members: s.members, invites: s.invites });
  }
  if (seg[0] === 'billing') {
    if (seg[1] === 'checkout')
      return commit(['bp', t, body.plan], () =>
        ok({ url: `${APP_URL()}/app/settings/billing?checkout=success` }),
      );
    if (seg[1] === 'change-plan')
      return commit(['bp', t, body.plan], () => ok({ ok: true, pending: false }));
    if (seg[1] === 'portal') return ok({ url: `${APP_URL()}/app/settings/billing` });
    return ok({
      subscription: s.me.subscription,
      usage: s.me.usage,
      prices: { pro: PLANS.pro.priceMonthlyUsd, business: PLANS.business.priceMonthlyUsd },
    });
  }
  if (seg[0] === 'audit') return ok(paginate(s.audit, query));
  if (seg[0] === 'admin') {
    if (seg[1] === 'overview')
      return ok({
        tenants: 128,
        users: 171,
        invoices: 4312,
        invoices_30d: 611,
        reminders_sent_30d: 1874,
        emails_failed_7d: 3,
        byPlan: [
          { plan: 'free', status: 'active', n: 91 },
          { plan: 'pro', status: 'active', n: 29 },
          { plan: 'pro', status: 'trialing', n: 5 },
          { plan: 'business', status: 'active', n: 3 },
        ],
        mrrUsd: 29 * 19 + 3 * 49,
        aiCostUsd30d: 12.41,
      });
    if (seg[1] === 'tenants') {
      if (seg[2] && seg[3]) return ok({ ok: true });
      const rows = [
        {
          id: 't1',
          name: 'Northlight Studio',
          slug: 'northlight-studio',
          createdAt: isoDay(-120),
          suspendedAt: null,
          onboardedAt: isoDay(-120),
          plan: s.me.subscription.plan,
          subscriptionStatus: s.me.subscription.status,
          ownerEmail: 'maya@northlight.studio',
          members: s.members.length,
          invoices: s.invoices.length,
          clients: s.clients.length,
        },
        {
          id: 't2',
          name: 'Pixel & Prose',
          slug: 'pixel-prose',
          createdAt: isoDay(-88),
          suspendedAt: null,
          onboardedAt: isoDay(-88),
          plan: 'business',
          subscriptionStatus: 'active',
          ownerEmail: 'hello@pixelprose.example',
          members: 6,
          invoices: 214,
          clients: 31,
        },
        {
          id: 't3',
          name: 'Ravi Consulting',
          slug: 'ravi-consulting',
          createdAt: isoDay(-30),
          suspendedAt: null,
          onboardedAt: isoDay(-29),
          plan: 'free',
          subscriptionStatus: 'active',
          ownerEmail: 'ravi@example.com',
          members: 1,
          invoices: 4,
          clients: 2,
        },
        {
          id: 't4',
          name: 'spam-signup-42',
          slug: 'spam-signup-42',
          createdAt: isoDay(-3),
          suspendedAt: isoDay(-2),
          onboardedAt: null,
          plan: 'free',
          subscriptionStatus: 'active',
          ownerEmail: 'x@mailinator.example',
          members: 1,
          invoices: 0,
          clients: 0,
        },
      ];
      return ok(paginate(rows, query));
    }
  }
  if (seg[0] === 'dashboard') {
    const open = s.invoices.filter((i) => OPEN.includes(i.status));
    const month = new Date(t).toISOString().slice(0, 7);
    const dto: DashboardDto = {
      currency: 'USD',
      outstandingCents: open.reduce((a, i) => a + i.totalCents - i.amountPaidCents, 0),
      overdueCents: open
        .filter((i) => i.status === 'overdue')
        .reduce((a, i) => a + i.totalCents - i.amountPaidCents, 0),
      overdueCount: open.filter((i) => i.status === 'overdue').length,
      paidThisMonthCents: s.invoices
        .flatMap((i) => i.payments)
        .filter((p) => p.paidAt.startsWith(month))
        .reduce((a, p) => a + p.amountCents, 0),
      draftCount: s.invoices.filter((i) => i.status === 'draft').length,
      upcomingReminders: open
        .flatMap((i) =>
          i.reminders
            .filter(
              (r) => r.status === 'pending' && Date.parse(r.scheduledFor) < t + 7 * 86_400_000,
            )
            .map((r) => ({
              id: r.id,
              invoiceId: i.id,
              invoiceNumber: i.number,
              clientName: s.clients.find((c) => c.id === i.clientId)!.name,
              scheduledFor: r.scheduledFor,
              kind: r.kind,
            })),
        )
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
        .slice(0, 10),
      recentActivity: s.audit.slice(0, 10),
    };
    return ok(dto);
  }

  // ─── clients ───
  if (seg[0] === 'clients') {
    if (!seg[1]) {
      if (method === 'POST') {
        const limit = s.me.usage.metrics.clients.limit;
        const current = s.clients.filter((c) => !c.archivedAt).length;
        if (limit !== null && current >= limit)
          return error(
            402,
            'PLAN_LIMIT_REACHED',
            `Your ${s.me.subscription.effectivePlan} plan allows ${limit} clients. Upgrade to continue.`,
            { limit: { metric: 'clients', limit, current, plan: s.me.subscription.effectivePlan } },
          );
        return commit(['cc', t, body], (st) => ok(clientDto(st, st.clients.at(-1)!), 201));
      }
      const q = (query.get('q') ?? '').toLowerCase();
      const list = s.clients
        .filter(
          (c) =>
            (query.get('includeArchived') === 'true' || !c.archivedAt) &&
            (!q || [c.name, c.email, c.company ?? ''].some((v) => v.toLowerCase().includes(q))),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      return ok(
        paginate(
          list.map((c) => clientDto(s, c)),
          query,
        ),
      );
    }
    const c = s.clients.find((x) => x.id === seg[1]);
    if (!c) return error(404, 'NOT_FOUND', 'Client not found');
    if (method === 'PATCH')
      return commit(['cu', t, c.id, body], (st) =>
        ok(
          clientDto(
            st,
            st.clients.find((x) => x.id === c.id)!,
          ),
        ),
      );
    if (method === 'DELETE') {
      if (s.invoices.some((i) => i.clientId === c.id && OPEN.includes(i.status)))
        return error(
          409,
          'CLIENT_HAS_OPEN_INVOICES',
          'This client has open invoices. Mark them paid or void first.',
        );
      return commit(['ca', t, c.id], () => ok({ ok: true }));
    }
    return ok(clientDto(s, c));
  }

  // ─── invoices ───
  if (seg[0] === 'invoices') {
    if (!seg[1]) {
      if (method === 'POST') {
        if (!s.clients.some((x) => x.id === body.clientId))
          return error(404, 'NOT_FOUND', 'Client not found');
        const limit = s.me.usage.metrics.invoices.limit;
        if (limit !== null && s.me.usage.metrics.invoices.used >= limit)
          return error(
            402,
            'PLAN_LIMIT_REACHED',
            `Your ${s.me.subscription.effectivePlan} plan allows ${limit} invoices per month. Upgrade to continue.`,
            {
              limit: {
                metric: 'invoices',
                limit,
                current: s.me.usage.metrics.invoices.used,
                plan: s.me.subscription.effectivePlan,
              },
            },
          );
        return commit(['ic', t, body], (st) => ok(invoiceDto(st, st.invoices[0]!), 201));
      }
      const status = query.get('status');
      const clientId = query.get('clientId');
      const q = (query.get('q') ?? '').toLowerCase();
      const list = s.invoices.filter(
        (i) =>
          (!status || i.status === status) &&
          (!clientId || i.clientId === clientId) &&
          (!q ||
            i.number.toLowerCase().includes(q) ||
            s.clients
              .find((c) => c.id === i.clientId)!
              .name.toLowerCase()
              .includes(q)),
      );
      return ok(
        paginate(
          list.map((i) => invoiceDto(s, i)),
          query,
        ),
      );
    }
    const inv = s.invoices.find((x) => x.id === seg[1]);
    if (!inv) return error(404, 'NOT_FOUND', 'Invoice not found');
    const action = seg[2];
    const after = (st: DemoState, status = 200) => {
      const x = st.invoices.find((y) => y.id === inv.id);
      return x ? ok(invoiceDto(st, x), status) : ok({ ok: true });
    };
    if (!action) {
      if (method === 'PUT') {
        if (inv.status !== 'draft')
          return error(409, 'INVOICE_NOT_DRAFT', 'Only draft invoices can be edited');
        return commit(['iu', t, inv.id, body], after);
      }
      if (method === 'DELETE') {
        if (inv.status !== 'draft')
          return error(409, 'INVOICE_NOT_DRAFT', 'Only draft invoices can be deleted');
        return commit(['id', t, inv.id], () => ok({ ok: true }));
      }
      return ok(invoiceDto(s, inv));
    }
    if (action === 'send') {
      if (inv.status !== 'draft')
        return error(409, 'INVOICE_ALREADY_SENT', 'Invoice has already been sent');
      return commit(['is', t, inv.id], after);
    }
    if (action === 'payments') {
      if (!OPEN.includes(inv.status))
        return error(409, 'INVOICE_NOT_OPEN', `Cannot record a payment on a ${inv.status} invoice`);
      const remaining = inv.totalCents - inv.amountPaidCents;
      if (Number(body.amountCents ?? remaining) > remaining)
        return error(422, 'OVERPAYMENT', `Payment exceeds the remaining balance (${remaining})`);
      return commit(
        [
          'ip',
          t,
          inv.id,
          body.amountCents ?? remaining,
          body.paidAt ?? isoDay(0, t),
          body.method ?? 'bank_transfer',
          body.note ?? null,
        ],
        after,
      );
    }
    if (action === 'void') {
      if (inv.status === 'paid' || inv.status === 'void')
        return error(409, 'INVOICE_NOT_VOIDABLE', `Cannot void a ${inv.status} invoice`);
      return commit(['iv', t, inv.id], after);
    }
    if (action === 'ai-draft') {
      if (!OPEN.includes(inv.status))
        return error(409, 'INVOICE_NOT_OPEN', 'Reminders can only be drafted for open invoices');
      const limit = s.me.usage.metrics.ai_drafts.limit;
      if (limit !== null && s.me.usage.metrics.ai_drafts.used >= limit)
        return error(
          402,
          'PLAN_LIMIT_REACHED',
          `Your ${s.me.subscription.effectivePlan} plan allows ${limit} AI drafts per month.`,
          {
            limit: {
              metric: 'ai_drafts',
              limit,
              current: s.me.usage.metrics.ai_drafts.used,
              plan: s.me.subscription.effectivePlan,
            },
          },
        );
      return commit(['ad', t, inv.id, String(body.tone ?? 'friendly')], (st) =>
        ok(st.invoices.find((y) => y.id === inv.id)!.drafts[0]),
      );
    }
    if (action === 'reminders' && seg[3] === 'send-now') {
      if (!OPEN.includes(inv.status))
        return error(409, 'INVOICE_NOT_OPEN', 'Reminders can only be sent for open invoices');
      return commit(['rs', t, inv.id, String(body.subject)], (st) => after(st, 202));
    }
    if (action === 'reminders' && seg[3] && method === 'DELETE') {
      const r = inv.reminders.find((x) => x.id === seg[3]);
      if (!r || r.status !== 'pending')
        return error(404, 'NOT_FOUND', 'Pending reminder not found');
      return commit(['rc', t, inv.id, r.id], after);
    }
  }
  return error(404, 'NOT_FOUND', `Route ${method} ${path} not found in demo`);
}
