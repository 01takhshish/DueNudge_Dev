import type { Tx } from '../db/tx.js';
import { enqueueSendEmail } from '../jobs/queues.js';
import type { RenderedEmail } from './templates.js';

/**
 * Transactional outbox (lightweight): the email row is written INSIDE the caller's transaction
 * and the queue job is added only after COMMIT. If the process dies between the two, the
 * `requeue-stale-emails` maintenance job picks the row up. Net effect: at-least-once delivery,
 * de-duplicated by the BullMQ jobId.
 */
export async function enqueueEmail(
  tx: Tx,
  input: RenderedEmail & {
    tenantId: string;
    to: string;
    template: string;
    invoiceId?: string | null;
    reminderId?: string | null;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(
    `INSERT INTO email_log (tenant_id, to_email, subject, template, html, text, invoice_id, reminder_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.tenantId,
      input.to,
      input.subject,
      input.template,
      input.html,
      input.text,
      input.invoiceId ?? null,
      input.reminderId ?? null,
    ],
  );
  tx.onCommit(() => enqueueSendEmail({ emailLogId: row.id, tenantId: input.tenantId }));
  return row.id;
}
