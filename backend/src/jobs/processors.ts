import type { Job } from 'bullmq';
import { withSystem, withSystemTenant } from '../db/tx.js';
import { emailProvider } from '../email/provider.js';
import { customReminderEmail, reminderEmail } from '../email/templates.js';
import { enqueueEmail } from '../email/service.js';
import { daysBetween, todayIso } from '../lib/dates.js';
import { logger } from '../lib/logger.js';
import { audit } from '../modules/audit/service.js';
import { publicInvoiceUrl } from '../modules/invoices/service.js';
import {
  enqueueSendEmail,
  enqueueSendReminder,
  type SendEmailJob,
  type SendReminderJob,
} from './queues.js';

/**
 * send-email: deliver one email_log row. Idempotent: a row already 'sent' is skipped, so a retry after
 * a crash-after-send never double-sends. Failures are recorded on the row and rethrown so BullMQ retries
 * with exponential backoff; after the last attempt the row stays 'failed' for the admin panel.
 */
export async function processSendEmail(job: Job<SendEmailJob>): Promise<void> {
  const { emailLogId, tenantId } = job.data;
  const row = await withSystemTenant(tenantId, (tx) =>
    tx.maybeOne<{
      id: string;
      to_email: string;
      subject: string;
      html: string;
      text: string;
      status: string;
      reminder_id: string | null;
    }>(
      `SELECT id, to_email, subject, html, text, status, reminder_id FROM email_log WHERE id = $1`,
      [emailLogId],
    ),
  );
  if (!row) return logger.warn({ emailLogId }, 'email_log row missing');
  if (row.status === 'sent') return;

  try {
    const result = await emailProvider().send({
      to: row.to_email,
      subject: row.subject,
      html: row.html,
      text: row.text,
    });
    await withSystemTenant(tenantId, async (tx) => {
      await tx.execute(
        `UPDATE email_log SET status = 'sent', provider = $2, provider_message_id = $3, attempts = attempts + 1, sent_at = now(), error = NULL WHERE id = $1`,
        [row.id, result.provider, result.messageId],
      );
    });
    job.log(`sent via ${result.provider} (${result.messageId ?? 'no id'})`);
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await withSystemTenant(tenantId, (tx) =>
      tx.execute(
        `UPDATE email_log SET status = CASE WHEN $3 THEN 'failed' ELSE status END, attempts = attempts + 1, error = $2 WHERE id = $1`,
        [row.id, message, job.attemptsMade + 1 >= (job.opts.attempts ?? 1)],
      ),
    );
    throw err;
  }
}

/** scan-due-reminders: every 15 min, enqueue every pending reminder whose time has come. */
export async function processScanDueReminders(): Promise<number> {
  const due = await withSystem((tx) =>
    tx.query<{ id: string; tenant_id: string }>(
      `SELECT r.id, r.tenant_id FROM reminders r JOIN invoices i ON i.id = r.invoice_id JOIN tenants t ON t.id = r.tenant_id
       WHERE r.status = 'pending' AND r.scheduled_for <= now() AND i.status IN ('sent','viewed','overdue') AND t.suspended_at IS NULL
       ORDER BY r.scheduled_for LIMIT 1000`,
    ),
  );
  for (const r of due) await enqueueSendReminder({ reminderId: r.id, tenantId: r.tenant_id });
  if (due.length) logger.info({ count: due.length }, 'enqueued due reminders');
  return due.length;
}

/**
 * send-reminder: claim the reminder row (pending -> sending) with a conditional UPDATE so two workers
 * can never both send it, render the email, write the outbox row, mark sent. All in one transaction
 * on the tenant's context; the email job itself is enqueued after commit.
 */
export async function processSendReminder(job: Job<SendReminderJob>): Promise<void> {
  const { reminderId, tenantId } = job.data;
  await withSystemTenant(tenantId, async (tx) => {
    const r = await tx.maybeOne<{
      id: string;
      invoice_id: string;
      kind: 'before_due' | 'on_due' | 'overdue' | 'manual';
      subject: string | null;
      body: string | null;
    }>(
      `UPDATE reminders SET status = 'sending', attempts = attempts + 1 WHERE id = $1 AND status IN ('pending','failed') RETURNING id, invoice_id, kind, subject, body`,
      [reminderId],
    );
    if (!r) return; // already sent / skipped / being sent by another worker
    try {
      const inv = await tx.one<{
        number: string;
        status: string;
        currency: string;
        total_cents: number;
        amount_paid_cents: number;
        due_date: string;
        payment_link: string | null;
        public_token: string | null;
        client_id: string;
      }>(
        `SELECT number, status, currency, total_cents, amount_paid_cents, due_date, payment_link, public_token, client_id FROM invoices WHERE id = $1`,
        [r.invoice_id],
      );
      if (!['sent', 'viewed', 'overdue'].includes(inv.status)) {
        await tx.execute(`UPDATE reminders SET status = 'skipped', last_error = $2 WHERE id = $1`, [
          r.id,
          `invoice is ${inv.status}`,
        ]);
        return;
      }
      const client = await tx.one<{ name: string; email: string }>(
        `SELECT name, email FROM clients WHERE id = $1`,
        [inv.client_id],
      );
      const tenant = await tx.one<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
        tenantId,
      ]);
      const publicUrl = publicInvoiceUrl(inv.public_token) ?? '';
      const rendered =
        r.subject && r.body
          ? customReminderEmail({
              businessName: tenant.name,
              subject: r.subject,
              body: r.body,
              publicUrl,
              paymentLink: inv.payment_link,
            })
          : reminderEmail({
              businessName: tenant.name,
              clientName: client.name,
              number: inv.number,
              totalCents: inv.total_cents,
              amountPaidCents: inv.amount_paid_cents,
              currency: inv.currency,
              dueDate: inv.due_date,
              daysUntilDue: daysBetween(todayIso(), inv.due_date),
              publicUrl,
              paymentLink: inv.payment_link,
              kind: r.kind,
            });
      const emailLogId = await enqueueEmail(tx, {
        tenantId,
        to: client.email,
        template: `reminder-${r.kind}`,
        invoiceId: r.invoice_id,
        reminderId: r.id,
        ...rendered,
      });
      await tx.execute(
        `UPDATE reminders SET status = 'sent', sent_at = now(), subject = $2, email_log_id = $3, last_error = NULL WHERE id = $1`,
        [r.id, rendered.subject, emailLogId],
      );
      await audit(tx, {
        tenantId,
        actorUserId: null,
        action: 'reminder.sent',
        entityType: 'invoice',
        entityId: r.invoice_id,
        metadata: { reminderId: r.id, kind: r.kind, to: client.email },
      });
    } catch (err) {
      // Mark failed inside the same tx so the state is consistent; rethrow so BullMQ retries.
      await tx.execute(`UPDATE reminders SET status = 'failed', last_error = $2 WHERE id = $1`, [
        r.id,
        (err as Error).message.slice(0, 500),
      ]);
      throw err;
    }
  });
}

/** mark-overdue-invoices: nightly status flip. Pure SQL, cross-tenant, idempotent. */
export async function processMarkOverdue(): Promise<number> {
  return withSystem(async (tx) => {
    const rows = await tx.query<{ id: string; tenant_id: string; number: string }>(
      `UPDATE invoices SET status = 'overdue' WHERE status IN ('sent','viewed') AND due_date < current_date RETURNING id, tenant_id, number`,
    );
    for (const r of rows)
      await audit(tx, {
        tenantId: r.tenant_id,
        actorUserId: null,
        action: 'invoice.overdue',
        entityType: 'invoice',
        entityId: r.id,
        metadata: { number: r.number },
      });
    if (rows.length) logger.info({ count: rows.length }, 'marked invoices overdue');
    return rows.length;
  });
}

/** requeue-stale-emails: outbox sweeper. Re-enqueues 'queued' rows older than 5 minutes (jobId dedupes). */
export async function processRequeueStaleEmails(): Promise<number> {
  const rows = await withSystem((tx) =>
    tx.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM email_log WHERE status = 'queued' AND created_at < now() - interval '5 minutes' AND attempts < 5 LIMIT 500`,
    ),
  );
  for (const r of rows) await enqueueSendEmail({ emailLogId: r.id, tenantId: r.tenant_id });
  if (rows.length) logger.info({ count: rows.length }, 'requeued stale emails');
  return rows.length;
}
