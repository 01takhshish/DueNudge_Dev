/**
 * Development seed: a platform admin, two tenants (so you can *see* isolation), clients and invoices in
 * every state, one overdue invoice with a reminder history. Safe to re-run (skips if the admin exists).
 * Login: owner@acme.test / Password123!   ·   owner@bright.test / Password123!   ·   admin@duenudge.test / Password123!
 */
import 'dotenv/config';
import { withSystem } from './tx.js';
import { closePool } from './pool.js';
import { hashPassword, randomToken } from '../lib/crypto.js';
import { addDays, todayIso } from '../lib/dates.js';
import { createTenantForUser } from '../modules/auth/service.js';
import { nextInvoiceNumber, replaceItems } from '../modules/invoices/service.js';
import { scheduleRemindersForInvoice } from '../modules/reminders/scheduling.js';

async function main() {
  await withSystem(async (tx) => {
    const exists = await tx.maybeOne(`SELECT 1 FROM users WHERE email = 'admin@duenudge.test'`);
    if (exists) {
      console.log('Seed already applied — skipping.');
      return;
    }
    const pw = await hashPassword('Password123!');
    const admin = await tx.one<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_platform_admin, email_verified_at) VALUES ('admin@duenudge.test', 'Platform Admin', $1, true, now()) RETURNING id`,
      [pw],
    );
    await createTenantForUser(tx, admin.id, 'DueNudge HQ');

    for (const [email, name, tenantName, currency] of [
      ['owner@acme.test', 'Ava Chen', 'Acme Design Studio', 'USD'],
      ['owner@bright.test', 'Ben Okafor', 'Bright Dev Co', 'EUR'],
    ] as const) {
      const user = await tx.one<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, now()) RETURNING id`,
        [email, name, pw],
      );
      const tenant = await createTenantForUser(tx, user.id, tenantName);
      await tx.execute(
        `UPDATE tenants SET currency = $2, onboarded_at = now(), business_email = $3, timezone = 'America/New_York' WHERE id = $1`,
        [tenant.id, currency, email],
      );
      await tx.execute(
        `UPDATE subscriptions SET plan = 'pro', status = 'active' WHERE tenant_id = $1`,
        [tenant.id],
      );

      const clients = [
        ['Northwind Traders', 'ap@northwind.test', 'Northwind'],
        ['Globex Corporation', 'billing@globex.test', 'Globex'],
        ['Initech', 'accounts@initech.test', 'Initech'],
      ];
      const clientIds: string[] = [];
      for (const [cname, cemail, company] of clients) {
        const c = await tx.one<{ id: string }>(
          `INSERT INTO clients (tenant_id, name, email, company) VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenant.id, cname, cemail, company],
        );
        clientIds.push(c.id);
      }
      const today = todayIso();
      const specs: Array<{
        client: number;
        status: string;
        issue: number;
        due: number;
        items: Array<[string, number, number]>;
        paid?: boolean;
      }> = [
        {
          client: 0,
          status: 'draft',
          issue: 0,
          due: 14,
          items: [['Brand identity — phase 1', 1, 250000]],
        },
        {
          client: 0,
          status: 'sent',
          issue: -2,
          due: 12,
          items: [
            ['Website redesign', 1, 480000],
            ['Hosting setup', 2, 15000],
          ],
        },
        {
          client: 1,
          status: 'viewed',
          issue: -10,
          due: 4,
          items: [['Monthly retainer — design', 1, 300000]],
        },
        {
          client: 1,
          status: 'overdue',
          issue: -40,
          due: -12,
          items: [
            ['Landing page', 1, 180000],
            ['Illustrations', 6, 12000],
          ],
        },
        {
          client: 2,
          status: 'paid',
          issue: -60,
          due: -30,
          items: [['API integration', 1, 520000]],
          paid: true,
        },
        {
          client: 2,
          status: 'paid',
          issue: -95,
          due: -65,
          items: [['Discovery workshop', 2, 90000]],
          paid: true,
        },
      ];
      for (const s of specs) {
        const number = await nextInvoiceNumber(tx, tenant.id);
        const inv = await tx.one<{ id: string; tenant_id: string; due_date: string }>(
          `INSERT INTO invoices (tenant_id, client_id, number, currency, issue_date, due_date, status, public_token, sent_at, viewed_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $7 <> 'draft' THEN now() END, CASE WHEN $7 IN ('viewed','overdue','paid') THEN now() END, $9)
           RETURNING id, tenant_id, due_date`,
          [
            tenant.id,
            clientIds[s.client],
            number,
            currency,
            addDays(today, s.issue),
            addDays(today, s.due),
            s.status,
            s.status === 'draft' ? null : randomToken(24),
            user.id,
          ],
        );
        const totals = await replaceItems(
          tx,
          tenant.id,
          inv.id,
          s.items.map(([description, quantity, unitCents]) => ({
            description,
            quantity,
            unitCents,
          })),
          0,
        );
        if (s.paid) {
          await tx.execute(
            `INSERT INTO invoice_payments (tenant_id, invoice_id, amount_cents, paid_at, method) VALUES ($1, $2, $3, $4, 'bank_transfer')`,
            [tenant.id, inv.id, totals.totalCents, addDays(today, s.due + 3)],
          );
          await tx.execute(
            `UPDATE invoices SET amount_paid_cents = $2, paid_at = $3 WHERE id = $1`,
            [inv.id, totals.totalCents, addDays(today, s.due + 3)],
          );
        }
        if (['sent', 'viewed', 'overdue'].includes(s.status)) {
          await scheduleRemindersForInvoice(tx, inv, {
            reminder_offsets: [-3, 0, 3, 7, 14],
            timezone: 'America/New_York',
          });
        }
        if (s.status === 'overdue') {
          await tx.execute(
            `INSERT INTO reminders (tenant_id, invoice_id, kind, offset_days, scheduled_for, status, sent_at, subject) VALUES ($1, $2, 'on_due', 0, now() - interval '12 days', 'sent', now() - interval '12 days', 'Invoice is due today')`,
            [tenant.id, inv.id],
          );
          await tx.execute(
            `INSERT INTO reminders (tenant_id, invoice_id, kind, offset_days, scheduled_for, status, sent_at, subject) VALUES ($1, $2, 'overdue', 7, now() - interval '5 days', 'sent', now() - interval '5 days', 'Overdue: 7 days')`,
            [tenant.id, inv.id],
          );
        }
      }
      console.log(`Seeded tenant "${tenantName}" (${email})`);
    }
  });
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
