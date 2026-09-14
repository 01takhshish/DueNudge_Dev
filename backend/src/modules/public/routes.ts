import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { PublicInvoiceDto } from '@duenudge/shared';
import { withSystem } from '../../db/tx.js';
import { notFound } from '../../lib/errors.js';

/** Unauthenticated invoice view, addressed by an unguessable token. Marks the invoice as viewed on first open. */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/invoices/:token',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: z.object({ token: z.string().min(10).max(100) }), tags: ['public'] },
    },
    async (req): Promise<PublicInvoiceDto> => {
      const { token } = req.params as { token: string };
      return withSystem(async (tx) => {
        const inv = await tx.maybeOne<{
          id: string;
          tenant_id: string;
          client_id: string;
          status: string;
          number: string;
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
        }>(
          `SELECT id, tenant_id, client_id, status, number, currency, issue_date, due_date, subtotal_cents, tax_rate_bps, tax_cents, total_cents, amount_paid_cents, notes, payment_link
         FROM invoices WHERE public_token = $1 AND status <> 'draft'`,
          [token],
        );
        if (!inv) throw notFound('Invoice');
        if (inv.status === 'sent') {
          await tx.execute(
            `UPDATE invoices SET status = 'viewed', viewed_at = now() WHERE id = $1 AND status = 'sent'`,
            [inv.id],
          );
          await tx.execute(
            `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, metadata, ip) VALUES ($1, 'invoice.viewed', 'invoice', $2, $3::jsonb, $4)`,
            [inv.tenant_id, inv.id, JSON.stringify({ number: inv.number }), req.ip],
          );
          inv.status = 'viewed';
        } else if (inv.status !== 'paid' && inv.status !== 'void') {
          await tx.execute(
            `UPDATE invoices SET viewed_at = COALESCE(viewed_at, now()) WHERE id = $1`,
            [inv.id],
          );
        }
        const items = await tx.query<PublicInvoiceDto['items'][number]>(
          `SELECT id, description, quantity::float AS quantity, unit_cents AS "unitCents", amount_cents AS "amountCents" FROM invoice_items WHERE invoice_id = $1 ORDER BY position`,
          [inv.id],
        );
        const business = await tx.one<PublicInvoiceDto['business']>(
          `SELECT name, business_email AS email, business_address AS address, logo_url AS "logoUrl" FROM tenants WHERE id = $1`,
          [inv.tenant_id],
        );
        const client = await tx.one<PublicInvoiceDto['client']>(
          `SELECT name, company, address FROM clients WHERE id = $1`,
          [inv.client_id],
        );
        return {
          number: inv.number,
          status: inv.status as PublicInvoiceDto['status'],
          currency: inv.currency,
          issueDate: inv.issue_date,
          dueDate: inv.due_date,
          subtotalCents: inv.subtotal_cents,
          taxRateBps: inv.tax_rate_bps,
          taxCents: inv.tax_cents,
          totalCents: inv.total_cents,
          amountPaidCents: inv.amount_paid_cents,
          notes: inv.notes,
          paymentLink: inv.payment_link,
          items,
          business,
          client,
        };
      });
    },
  );
};
