import type { Tx } from '../../db/tx.js';
import { addDays, localDateTimeToUtc } from '../../lib/dates.js';

export const REMINDER_SEND_HOUR = 9; // 09:00 in the tenant's timezone

export function kindForOffset(offset: number): 'before_due' | 'on_due' | 'overdue' {
  return offset < 0 ? 'before_due' : offset === 0 ? 'on_due' : 'overdue';
}

/** Pure: which reminders an invoice sent *now* should get. Past-dated reminders are dropped rather than blasted. */
export function planReminders(input: {
  dueDate: string;
  offsets: number[];
  timezone: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return [...new Set(input.offsets)]
    .sort((a, b) => a - b)
    .map((offset) => ({
      offset,
      kind: kindForOffset(offset),
      scheduledFor: localDateTimeToUtc(
        addDays(input.dueDate, offset),
        REMINDER_SEND_HOUR,
        input.timezone,
      ),
    }))
    .filter((r) => r.scheduledFor.getTime() > now.getTime());
}

/** Materializes the reminder rows for a just-sent invoice. Idempotent thanks to the (invoice, offset) unique index. */
export async function scheduleRemindersForInvoice(
  tx: Tx,
  invoice: { id: string; tenant_id: string; due_date: string },
  tenant: { reminder_offsets: number[]; timezone: string },
): Promise<number> {
  const plan = planReminders({
    dueDate: invoice.due_date,
    offsets: tenant.reminder_offsets,
    timezone: tenant.timezone,
  });
  let created = 0;
  for (const r of plan) {
    created += await tx.execute(
      `INSERT INTO reminders (tenant_id, invoice_id, kind, offset_days, scheduled_for) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (invoice_id, offset_days) WHERE offset_days IS NOT NULL DO NOTHING`,
      [invoice.tenant_id, invoice.id, r.kind, r.offset, r.scheduledFor],
    );
  }
  return created;
}

export async function skipPendingReminders(
  tx: Tx,
  invoiceId: string,
  reason: string,
): Promise<number> {
  return tx.execute(
    `UPDATE reminders SET status = 'skipped', last_error = $2 WHERE invoice_id = $1 AND status IN ('pending','failed')`,
    [invoiceId, reason],
  );
}
