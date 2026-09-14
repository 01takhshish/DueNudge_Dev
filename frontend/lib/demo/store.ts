import type {
  AuditEntryDto,
  ClientDto,
  InvoiceDto,
  InvoiceStatus,
  MeDto,
  TenantDto,
} from '@duenudge/shared';

/**
 * Demo state = deterministic seed + the visitor's mutation log (see handler.ts). Everything here must
 * be reproducible: ids are fixed strings, dates are relative to "today". No randomness.
 */
export interface DemoState {
  me: MeDto;
  clients: Array<
    Omit<ClientDto, 'outstandingCents' | 'overdueCents' | 'invoiceCount' | 'avgDaysToPay'>
  >;
  invoices: Array<
    Omit<InvoiceDto, 'clientName' | 'clientEmail' | 'publicUrl'> & { publicToken: string | null }
  >;
  audit: AuditEntryDto[];
  invites: Array<{
    id: string;
    email: string;
    role: 'admin' | 'member';
    expiresAt: string;
    createdAt: string;
  }>;
  members: Array<{
    userId: string;
    name: string;
    email: string;
    role: 'owner' | 'admin' | 'member';
    joinedAt: string;
  }>;
  counter: number;
}

const dayMs = 86_400_000;
export const isoDay = (offset = 0, from = Date.now()) =>
  new Date(from + offset * dayMs).toISOString().slice(0, 10);
const at = (offsetDays: number, hour = 10) => {
  const d = new Date(Date.now() + offsetDays * dayMs);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

export const TENANT_ID = 'demo-tenant';
export const USER_ID = 'demo-user';

export function seedState(): DemoState {
  const tenant: TenantDto = {
    id: TENANT_ID,
    name: 'Northlight Studio',
    slug: 'northlight-studio',
    currency: 'USD',
    timezone: 'America/New_York',
    businessEmail: 'billing@northlight.studio',
    businessAddress: '48 Harbor Street, Suite 3\nPortland, ME 04101',
    logoUrl: null,
    reminderOffsets: [-3, 0, 3, 7, 14],
    defaultPaymentTermsDays: 14,
    onboardedAt: at(-120),
    suspendedAt: null,
    createdAt: at(-120),
  };
  const clients: DemoState['clients'] = [
    {
      id: 'c-globex',
      name: 'Priya Natarajan',
      email: 'ap@globex.example',
      company: 'Globex Corporation',
      phone: '+1 415 555 0142',
      address: '1 Market St, San Francisco, CA',
      notes: 'Pays net-30 regardless of terms. Loop in Dan for anything over $5k.',
      paymentTermsDays: 14,
      archivedAt: null,
      createdAt: at(-110),
    },
    {
      id: 'c-initech',
      name: 'Marcus Lee',
      email: 'accounts@initech.example',
      company: 'Initech',
      phone: null,
      address: null,
      notes: null,
      paymentTermsDays: 14,
      archivedAt: null,
      createdAt: at(-95),
    },
    {
      id: 'c-hooli',
      name: 'Sofia Reyes',
      email: 'finance@hooli.example',
      company: 'Hooli',
      phone: '+1 650 555 0199',
      address: null,
      notes: 'Prefers invoices split per milestone.',
      paymentTermsDays: 30,
      archivedAt: null,
      createdAt: at(-70),
    },
    {
      id: 'c-vandelay',
      name: 'Art Vandelay',
      email: 'art@vandelay.example',
      company: 'Vandelay Industries',
      phone: null,
      address: null,
      notes: null,
      paymentTermsDays: 7,
      archivedAt: null,
      createdAt: at(-40),
    },
  ];

  let n = 0;
  const mk = (
    clientId: string,
    status: InvoiceStatus,
    issue: number,
    due: number,
    items: Array<[string, number, number]>,
    extra: Partial<DemoState['invoices'][number]> = {},
  ): DemoState['invoices'][number] => {
    const num = `INV-${String(++n).padStart(4, '0')}`;
    const id = `i-${String(n).padStart(4, '0')}`;
    const lines = items.map(([description, quantity, unitCents], k) => ({
      id: `${id}-l${k}`,
      description,
      quantity,
      unitCents,
      amountCents: Math.round(quantity * unitCents),
    }));
    const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
    const taxRateBps = extra.taxRateBps ?? 0;
    const tax = Math.round((subtotal * taxRateBps) / 10_000);
    const total = subtotal + tax;
    const sent = status !== 'draft';
    const paid = status === 'paid';
    const reminders: InvoiceDto['reminders'] = sent
      ? [-3, 0, 3, 7, 14].map((offset) => {
          const when = at(due + offset, 13);
          const past = new Date(when).getTime() < Date.now();
          const kind = offset < 0 ? 'before_due' : offset === 0 ? 'on_due' : 'overdue';
          const st: InvoiceDto['reminders'][number]['status'] =
            paid || status === 'void' ? (past ? 'sent' : 'skipped') : past ? 'sent' : 'pending';
          const subject =
            kind === 'overdue'
              ? `Overdue: invoice ${num} ($${(total / 100).toFixed(2)})`
              : kind === 'on_due'
                ? `Invoice ${num} is due today`
                : `Reminder: invoice ${num} is due soon`;
          return {
            id: `${id}-r${offset}`,
            kind,
            offsetDays: offset,
            scheduledFor: when,
            status: st,
            attempts: st === 'sent' ? 1 : 0,
            lastError: null,
            sentAt: st === 'sent' ? when : null,
            subject: st === 'sent' ? subject : null,
          };
        })
      : [];
    return {
      id,
      number: num,
      status,
      currency: 'USD',
      issueDate: isoDay(issue),
      dueDate: isoDay(due),
      subtotalCents: subtotal,
      taxRateBps,
      taxCents: tax,
      totalCents: total,
      amountPaidCents: paid ? total : (extra.amountPaidCents ?? 0),
      clientId,
      sentAt: sent ? at(issue, 9) : null,
      viewedAt: status === 'viewed' || status === 'overdue' || paid ? at(issue + 1, 15) : null,
      paidAt: paid ? at(due + 2, 11) : null,
      createdAt: at(issue, 9),
      notes: extra.notes ?? 'Thank you for your business. Bank transfer details are on file.',
      paymentLink: extra.paymentLink ?? null,
      publicToken: sent ? `demo-${num.toLowerCase()}` : null,
      items: lines,
      payments: paid
        ? [
            {
              id: `${id}-p0`,
              amountCents: total,
              paidAt: isoDay(due + 2),
              method: 'bank_transfer',
              note: null,
            },
          ]
        : [],
      reminders,
      drafts: [],
    };
  };

  const invoices: DemoState['invoices'] = [
    mk('c-globex', 'paid', -75, -61, [
      ['Brand identity system', 1, 620000],
      ['Stationery set', 1, 85000],
    ]),
    mk('c-initech', 'paid', -60, -46, [['Marketing site — design & build', 1, 890000]], {
      taxRateBps: 800,
    }),
    mk('c-hooli', 'paid', -50, -20, [['Discovery workshop (2 days)', 2, 180000]]),
    mk(
      'c-globex',
      'overdue',
      -34,
      -20,
      [
        ['Quarterly retainer — design ops', 1, 400000],
        ['Illustration pack', 6, 15000],
      ],
      { amountPaidCents: 100000 },
    ),
    mk('c-vandelay', 'overdue', -16, -9, [['Pitch deck redesign', 1, 240000]], {
      paymentLink: 'https://buy.stripe.com/test_demo',
    }),
    mk('c-hooli', 'viewed', -8, 22, [['Mobile app UI — phase 1', 1, 1250000]], { taxRateBps: 800 }),
    mk('c-initech', 'sent', -2, 12, [['Landing page A/B variants', 3, 95000]]),
    mk('c-globex', 'draft', 0, 14, [['Brand refresh — phase 2', 1, 480000]]),
  ].reverse(); // newest first, like the API

  const audit: AuditEntryDto[] = (
    [
      ['invoice.created', 'invoice', 'INV-0008', 0],
      ['invoice.sent', 'invoice', 'INV-0007', -2],
      ['reminder.sent', 'invoice', 'INV-0005', -2],
      ['invoice.viewed', 'invoice', 'INV-0006', -7],
      ['invoice.overdue', 'invoice', 'INV-0005', -9],
      ['invoice.partially_paid', 'invoice', 'INV-0004', -12],
      ['invoice.paid', 'invoice', 'INV-0003', -18],
      ['client.created', 'client', 'Vandelay Industries', -40],
      ['member.joined', 'membership', 'Jules Bennett', -55],
      ['tenant.onboarded', 'tenant', 'Northlight Studio', -120],
    ] as Array<[string, string, string, number]>
  ).map(([action, entityType, ref, days], i) => ({
    id: `a-seed-${i}`,
    action,
    entityType,
    entityId: null,
    actorName: ['reminder.sent', 'invoice.overdue', 'invoice.viewed'].includes(action)
      ? null
      : 'Maya Okafor',
    metadata: { number: ref },
    createdAt: at(days, 14),
  }));

  const me: MeDto = {
    user: {
      id: USER_ID,
      email: 'maya@northlight.studio',
      name: 'Maya Okafor',
      isPlatformAdmin: true,
      createdAt: at(-120),
    },
    tenant,
    role: 'owner',
    memberships: [{ tenantId: TENANT_ID, tenantName: 'Northlight Studio', role: 'owner' }],
    subscription: {
      plan: 'pro',
      effectivePlan: 'pro',
      status: 'trialing',
      trialEndsAt: at(9),
      currentPeriodEnd: at(9),
      cancelAtPeriodEnd: false,
      hasStripeCustomer: true,
    },
    usage: {
      period: new Date().toISOString().slice(0, 7),
      metrics: {
        clients: { used: 4, limit: null },
        invoices: { used: 2, limit: null },
        members: { used: 2, limit: 3 },
        ai_drafts: { used: 7, limit: 100 },
      },
    },
  };

  return {
    me,
    clients,
    invoices,
    audit,
    invites: [],
    members: [
      {
        userId: USER_ID,
        name: 'Maya Okafor',
        email: 'maya@northlight.studio',
        role: 'owner',
        joinedAt: at(-120),
      },
      {
        userId: 'demo-user-2',
        name: 'Jules Bennett',
        email: 'jules@northlight.studio',
        role: 'member',
        joinedAt: at(-55),
      },
    ],
    counter: n,
  };
}
