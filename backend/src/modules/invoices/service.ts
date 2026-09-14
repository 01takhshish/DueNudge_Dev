import type { InvoiceDto, InvoiceInput, InvoiceSummaryDto } from '@duenudge/shared';
import { config } from '../../config.js';
import type { Tx } from '../../db/tx.js';
import { computeTotals } from '../../lib/money.js';

export const INVOICE_SUMMARY_SELECT = `
  i.id, i.number, i.status, i.currency, i.issue_date AS "issueDate", i.due_date AS "dueDate",
  i.total_cents AS "totalCents", i.amount_paid_cents AS "amountPaidCents", i.client_id AS "clientId", c.name AS "clientName",
  i.sent_at AS "sentAt", i.viewed_at AS "viewedAt", i.paid_at AS "paidAt", i.created_at AS "createdAt"`;

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  client_id: string;
  number: string;
  status: InvoiceSummaryDto['status'];
  currency: string;
  issue_date: string;
  due_date: string;
  subtotal_cents: number;
  tax_rate_bps: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  notes: string | null;
  payment_link: string | null;
  public_token: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  paid_at: string | null;
}

export const publicInvoiceUrl = (token: string | null) =>
  token ? `${config.APP_URL}/i/${token}` : null;

export async function lockInvoice(tx: Tx, id: string): Promise<InvoiceRow> {
  return tx.one<InvoiceRow>(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id], 'Invoice');
}

/** Per-tenant sequential numbers, allocated atomically (UPDATE ... RETURNING on the counter row). */
export async function nextInvoiceNumber(tx: Tx, tenantId: string): Promise<string> {
  const row = await tx.one<{ n: number }>(
    `INSERT INTO invoice_counters (tenant_id, next_number) VALUES ($1, 2)
     ON CONFLICT (tenant_id) DO UPDATE SET next_number = invoice_counters.next_number + 1
     RETURNING next_number - 1 AS n`,
    [tenantId],
  );
  return `INV-${String(row.n).padStart(4, '0')}`;
}

export async function replaceItems(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
  items: InvoiceInput['items'],
  taxRateBps: number,
) {
  const totals = computeTotals(items, taxRateBps);
  await tx.execute(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
  for (const [idx, line] of totals.lines.entries()) {
    await tx.execute(
      `INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_cents, amount_cents, position) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, invoiceId, line.description, line.quantity, line.unitCents, line.amountCents, idx],
    );
  }
  await tx.execute(
    `UPDATE invoices SET subtotal_cents = $2, tax_rate_bps = $3, tax_cents = $4, total_cents = $5 WHERE id = $1`,
    [invoiceId, totals.subtotalCents, taxRateBps, totals.taxCents, totals.totalCents],
  );
  return totals;
}

export async function loadInvoiceDto(tx: Tx, id: string): Promise<InvoiceDto> {
  const inv = await tx.one<
    InvoiceSummaryDto & {
      subtotalCents: number;
      taxRateBps: number;
      taxCents: number;
      notes: string | null;
      paymentLink: string | null;
      publicToken: string | null;
      clientEmail: string;
    }
  >(
    `SELECT ${INVOICE_SUMMARY_SELECT}, i.subtotal_cents AS "subtotalCents", i.tax_rate_bps AS "taxRateBps", i.tax_cents AS "taxCents",
            i.notes, i.payment_link AS "paymentLink", i.public_token AS "publicToken", c.email AS "clientEmail"
     FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = $1`,
    [id],
    'Invoice',
  );
  const items = await tx.query<InvoiceDto['items'][number]>(
    `SELECT id, description, quantity::float AS quantity, unit_cents AS "unitCents", amount_cents AS "amountCents" FROM invoice_items WHERE invoice_id = $1 ORDER BY position`,
    [id],
  );
  const payments = await tx.query<InvoiceDto['payments'][number]>(
    `SELECT id, amount_cents AS "amountCents", paid_at AS "paidAt", method, note FROM invoice_payments WHERE invoice_id = $1 ORDER BY paid_at DESC, created_at DESC`,
    [id],
  );
  const reminders = await tx.query<InvoiceDto['reminders'][number]>(
    `SELECT id, kind, offset_days AS "offsetDays", scheduled_for AS "scheduledFor", status, attempts, last_error AS "lastError", sent_at AS "sentAt", subject
     FROM reminders WHERE invoice_id = $1 ORDER BY scheduled_for`,
    [id],
  );
  const drafts = await tx.query<InvoiceDto['drafts'][number]>(
    `SELECT id, tone, subject, body, model, created_at AS "createdAt" FROM ai_drafts WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [id],
  );
  const { publicToken, ...rest } = inv;
  return { ...rest, publicUrl: publicInvoiceUrl(publicToken), items, payments, reminders, drafts };
}
