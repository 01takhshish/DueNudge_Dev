import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDatabase } from '../helpers/db.js';
import {
  createClient,
  createInvoice,
  enqueued,
  makeApp,
  signup,
  todayPlus,
  type Session,
} from '../helpers/app.js';
import { closePool } from '../../src/db/pool.js';
import { withSystem } from '../../src/db/tx.js';
import {
  processMarkOverdue,
  processScanDueReminders,
  processSendEmail,
  processSendReminder,
} from '../../src/jobs/processors.js';
import { setEmailProvider } from '../../src/email/provider.js';

let app: FastifyInstance;
let s: Session;
let clientId: string;
const sent: Array<{ to: string; subject: string }> = [];

beforeAll(async () => {
  await resetDatabase();
  app = await makeApp();
  s = await signup(app, 'inv@example.com', { tenantName: 'Studio' });
  await withSystem((tx) =>
    tx.execute(
      `UPDATE tenants SET timezone = 'Europe/Berlin', reminder_offsets = '{-3,0,7}' WHERE id = $1`,
      [s.tenantId],
    ),
  );
  clientId = (await createClient(app, s, { name: 'Globex', email: 'ap@globex.test' })).json().id;
  setEmailProvider({
    name: 'fake',
    send: async (e) => (
      sent.push({ to: e.to, subject: e.subject }),
      { provider: 'fake', messageId: 'm1' }
    ),
  });
});
afterAll(async () => {
  setEmailProvider(null);
  await app.close();
  await closePool();
});

describe('invoice lifecycle', () => {
  let id: string;
  let publicUrl: string;

  it('creates a draft with sequential numbering and computed totals', async () => {
    const res = await createInvoice(app, s, clientId, {
      taxRateBps: 1000,
      items: [
        { description: 'Design', quantity: 2, unitCents: 50000 },
        { description: 'Dev', quantity: 1.5, unitCents: 80000 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const inv = res.json();
    id = inv.id;
    expect(inv).toMatchObject({
      number: 'INV-0001',
      status: 'draft',
      subtotalCents: 220000,
      taxCents: 22000,
      totalCents: 242000,
      publicUrl: null,
    });
    expect((await createInvoice(app, s, clientId)).json().number).toBe('INV-0002');
  });

  it('rejects invalid input (due before issue, empty items)', async () => {
    const res = await createInvoice(app, s, clientId, {
      issueDate: todayPlus(5),
      dueDate: todayPlus(1),
    });
    expect(res.statusCode).toBe(400);
    expect((await createInvoice(app, s, clientId, { items: [] })).statusCode).toBe(400);
  });

  it('sends: status -> sent, public link, email queued, reminders scheduled for future offsets only', async () => {
    enqueued.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${id}/send`,
      headers: { cookie: s.cookie },
    });
    expect(res.statusCode).toBe(200);
    const inv = res.json();
    expect(inv.status).toBe('sent');
    expect(inv.publicUrl).toMatch(/\/i\/[A-Za-z0-9_-]+$/);
    publicUrl = inv.publicUrl;
    expect(
      inv.reminders.map((r: { offsetDays: number; kind: string }) => [r.offsetDays, r.kind]),
    ).toEqual([
      [-3, 'before_due'],
      [0, 'on_due'],
      [7, 'overdue'],
    ]);
    expect(enqueued).toHaveLength(1);
    // sending twice is rejected
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/invoices/${id}/send`,
          headers: { cookie: s.cookie },
        })
      ).statusCode,
    ).toBe(409);
    // sent invoices cannot be edited or deleted
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/invoices/${id}`,
          headers: { cookie: s.cookie },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('email worker delivers the queued email exactly once', async () => {
    const job = enqueued[0]!.data as { emailLogId: string; tenantId: string };
    const fakeJob = {
      data: job,
      attemptsMade: 0,
      opts: { attempts: 5 },
      log: () => undefined,
    } as never;
    await processSendEmail(fakeJob);
    await processSendEmail(fakeJob); // retry after crash-after-send must be a no-op
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'ap@globex.test',
      subject: expect.stringContaining('INV-0001'),
    });
    const log = await withSystem((tx) =>
      tx.one<{ status: string; provider: string }>(
        `SELECT status, provider FROM email_log WHERE id = $1`,
        [job.emailLogId],
      ),
    );
    expect(log).toEqual({ status: 'sent', provider: 'fake' });
  });

  it('public page: viewable without auth, marks the invoice viewed, never exposes drafts', async () => {
    const token = publicUrl.split('/i/')[1]!;
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/invoices/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      number: 'INV-0001',
      status: 'viewed',
      business: { name: 'Studio' },
      client: { name: 'Globex' },
    });
    expect(res.json().items).toHaveLength(2);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/public/invoices/not-a-real-token-at-all` }))
        .statusCode,
    ).toBe(404);
    const inv = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/invoices/${id}`,
        headers: { cookie: s.cookie },
      })
    ).json();
    expect(inv.status).toBe('viewed');
    expect(inv.viewedAt).not.toBeNull();
  });

  it('manual reminder: queued -> worker claims once -> email sent with authored subject', async () => {
    enqueued.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${id}/reminders/send-now`,
      headers: { cookie: s.cookie },
      payload: {
        subject: 'Quick nudge on INV-0001',
        body: 'Hi there,\n\nJust checking in on this one.',
      },
    });
    expect(res.statusCode).toBe(202);
    const reminderJob = enqueued.find((e) => e.type === 'reminder')!.data as {
      reminderId: string;
      tenantId: string;
    };
    await processSendReminder({ data: reminderJob } as never);
    await processSendReminder({ data: reminderJob } as never); // second worker: already claimed
    const rem = await withSystem((tx) =>
      tx.one<{ status: string; email_log_id: string }>(
        `SELECT status, email_log_id FROM reminders WHERE id = $1`,
        [reminderJob.reminderId],
      ),
    );
    expect(rem.status).toBe('sent');
    const emails = await withSystem((tx) =>
      tx.query(`SELECT id FROM email_log WHERE reminder_id = $1`, [reminderJob.reminderId]),
    );
    expect(emails).toHaveLength(1);
  });

  it('overdue job flips past-due open invoices; scheduler enqueues due reminders', async () => {
    // Backdate the invoice so it's overdue and its on_due reminder is due
    await withSystem(async (tx) => {
      await tx.execute(
        `UPDATE invoices SET issue_date = current_date - 20, due_date = current_date - 5 WHERE id = $1`,
        [id],
      );
      await tx.execute(
        `UPDATE reminders SET scheduled_for = now() - interval '1 hour' WHERE invoice_id = $1 AND offset_days = 0`,
        [id],
      );
    });
    expect(await processMarkOverdue()).toBe(1);
    expect(await processMarkOverdue()).toBe(0); // idempotent
    enqueued.length = 0;
    expect(await processScanDueReminders()).toBe(1);
    const job = enqueued[0]!.data as { reminderId: string; tenantId: string };
    await processSendReminder({ data: job } as never);
    const rem = await withSystem((tx) =>
      tx.one<{ status: string; subject: string }>(
        `SELECT status, subject FROM reminders WHERE id = $1`,
        [job.reminderId],
      ),
    );
    expect(rem.status).toBe('sent');
    expect(rem.subject).toContain('due today');
  });

  it('partial then full payment: status paid, pending reminders skipped, overpayment rejected', async () => {
    const part = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${id}/payments`,
      headers: { cookie: s.cookie },
      payload: { amountCents: 100000, method: 'bank_transfer' },
    });
    expect(part.statusCode).toBe(200);
    expect(part.json()).toMatchObject({ status: 'overdue', amountPaidCents: 100000 });
    const over = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${id}/payments`,
      headers: { cookie: s.cookie },
      payload: { amountCents: 999999 },
    });
    expect(over.statusCode).toBe(422);
    const full = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${id}/payments`,
      headers: { cookie: s.cookie },
      payload: {},
    });
    expect(full.json()).toMatchObject({ status: 'paid', amountPaidCents: 242000 });
    const pending = full.json().reminders.filter((r: { status: string }) => r.status === 'pending');
    expect(pending).toHaveLength(0);
    expect(full.json().reminders.some((r: { status: string }) => r.status === 'skipped')).toBe(
      true,
    );
    // A skipped reminder is never sent even if the scheduler runs
    expect(await processScanDueReminders()).toBe(0);
  });

  it('void: allowed for open invoices, not for paid; dashboard reflects totals', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/invoices/${id}/void`,
          headers: { cookie: s.cookie },
        })
      ).statusCode,
    ).toBe(409);
    const draft = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/invoices?status=draft',
        headers: { cookie: s.cookie },
      })
    ).json().items[0];
    const v = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${draft.id}/void`,
      headers: { cookie: s.cookie },
    });
    expect(v.json().status).toBe('void');
    const dash = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/dashboard/summary',
        headers: { cookie: s.cookie },
      })
    ).json();
    expect(dash).toMatchObject({
      currency: 'USD',
      outstandingCents: 0,
      overdueCount: 0,
      paidThisMonthCents: 242000,
    });
    expect(dash.recentActivity.map((a: { action: string }) => a.action)).toContain('invoice.paid');
    const client = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/clients/${clientId}`,
        headers: { cookie: s.cookie },
      })
    ).json();
    expect(client).toMatchObject({ invoiceCount: 1, outstandingCents: 0 });
    expect(client.avgDaysToPay).toBeGreaterThanOrEqual(19);
  });
});
