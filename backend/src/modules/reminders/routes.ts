import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  aiDraftSchema,
  sendReminderNowSchema,
  type AiDraftDto,
  type InvoiceDto,
} from '@duenudge/shared';
import { withTenant } from '../../db/tx.js';
import { conflict, notFound } from '../../lib/errors.js';
import { daysBetween, todayIso } from '../../lib/dates.js';
import { enqueueSendReminder } from '../../jobs/queues.js';
import { draftReminder } from '../../ai/draft-reminder.js';
import { audit } from '../audit/service.js';
import { assertWithinLimit } from '../usage/service.js';
import { loadInvoiceDto, lockInvoice } from '../invoices/service.js';

const idParam = z.object({ id: z.uuid() });
const reminderParam = z.object({ id: z.uuid(), reminderId: z.uuid() });
const OPEN = ['sent', 'viewed', 'overdue'];

export const reminderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** AI: draft a reminder for this invoice. Metered per plan (ai_drafts / month). */
  app.post(
    '/:id/ai-draft',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: idParam, body: aiDraftSchema, tags: ['reminders'] },
    },
    async (req): Promise<AiDraftDto> => {
      const { id } = req.params as { id: string };
      const { tone } = req.body as z.infer<typeof aiDraftSchema>;
      const auth = req.auth!;

      // 1) Gather context + reserve quota in one short transaction.
      const ctx = await withTenant(auth.tenantId, async (tx) => {
        const inv = await tx.one<{
          number: string;
          status: string;
          currency: string;
          total_cents: number;
          amount_paid_cents: number;
          issue_date: string;
          due_date: string;
          payment_link: string | null;
          client_id: string;
        }>(
          `SELECT number, status, currency, total_cents, amount_paid_cents, issue_date, due_date, payment_link, client_id FROM invoices WHERE id = $1`,
          [id],
          'Invoice',
        );
        if (!OPEN.includes(inv.status))
          throw conflict(
            'Reminders can only be drafted for open (sent/overdue) invoices',
            'INVOICE_NOT_OPEN',
          );
        await assertWithinLimit(tx, auth.tenantId, 'ai_drafts');
        const client = await tx.one<{ name: string; company: string | null }>(
          `SELECT name, company FROM clients WHERE id = $1`,
          [inv.client_id],
        );
        const tenant = await tx.one<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
          auth.tenantId,
        ]);
        const user = await tx.one<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
          auth.userId,
        ]);
        const [hist] = await tx.query<{ paid: number; avg_days: number | null; late: number }>(
          `SELECT count(*) FILTER (WHERE status = 'paid')::int AS paid,
                round(avg(paid_at::date - issue_date) FILTER (WHERE status = 'paid'))::int AS avg_days,
                count(*) FILTER (WHERE status = 'paid' AND paid_at::date > due_date)::int AS late
         FROM invoices WHERE client_id = $1 AND id <> $2`,
          [inv.client_id, id],
        );
        const [rem] = await tx.query<{ sent: number; last: string | null }>(
          `SELECT count(*)::int AS sent, max(sent_at) AS last FROM reminders WHERE invoice_id = $1 AND status = 'sent'`,
          [id],
        );
        return {
          tone,
          businessName: tenant.name,
          senderName: user.name,
          client,
          invoice: {
            number: inv.number,
            currency: inv.currency,
            totalCents: inv.total_cents,
            amountPaidCents: inv.amount_paid_cents,
            issueDate: inv.issue_date,
            dueDate: inv.due_date,
            daysOverdue: daysBetween(inv.due_date, todayIso()),
            paymentLink: inv.payment_link,
          },
          history: {
            paidInvoices: hist?.paid ?? 0,
            avgDaysToPay: hist?.avg_days ?? null,
            lateInvoices: hist?.late ?? 0,
            remindersAlreadySent: rem?.sent ?? 0,
            lastReminderAt: rem?.last ?? null,
          },
        };
      });

      // 2) Call the model outside any DB transaction (never hold a connection across a network call).
      const draft = await draftReminder(ctx);

      // 3) Persist the draft with its token/cost accounting.
      return withTenant(auth.tenantId, async (tx) => {
        const row = await tx.one<AiDraftDto>(
          `INSERT INTO ai_drafts (tenant_id, invoice_id, tone, subject, body, model, input_tokens, output_tokens, cost_micros, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, tone, subject, body, model, created_at AS "createdAt"`,
          [
            auth.tenantId,
            id,
            tone,
            draft.subject,
            draft.body,
            draft.model,
            draft.inputTokens,
            draft.outputTokens,
            draft.costMicros,
            auth.userId,
          ],
        );
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'reminder.ai_drafted',
          entityType: 'invoice',
          entityId: id,
          metadata: {
            tone,
            model: draft.model,
            inputTokens: draft.inputTokens,
            outputTokens: draft.outputTokens,
          },
          ip: req.ip,
        });
        return row;
      });
    },
  );

  /** Send a one-off reminder now (with an AI or hand-written subject/body). */
  app.post(
    '/:id/reminders/send-now',
    { schema: { params: idParam, body: sendReminderNowSchema, tags: ['reminders'] } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof sendReminderNowSchema>;
      const auth = req.auth!;
      const dto = await withTenant(auth.tenantId, async (tx) => {
        const inv = await lockInvoice(tx, id);
        if (!OPEN.includes(inv.status))
          throw conflict('Reminders can only be sent for open invoices', 'INVOICE_NOT_OPEN');
        const row = await tx.one<{ id: string }>(
          `INSERT INTO reminders (tenant_id, invoice_id, kind, scheduled_for, subject, body) VALUES ($1, $2, 'manual', now(), $3, $4) RETURNING id`,
          [auth.tenantId, id, body.subject, body.body],
        );
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'reminder.manual_queued',
          entityType: 'invoice',
          entityId: id,
          metadata: { reminderId: row.id, subject: body.subject },
          ip: req.ip,
        });
        tx.onCommit(() => enqueueSendReminder({ reminderId: row.id, tenantId: auth.tenantId }));
        return loadInvoiceDto(tx, id);
      });
      return reply.status(202).send(dto);
    },
  );

  /** Cancel a scheduled reminder. */
  app.delete(
    '/:id/reminders/:reminderId',
    { schema: { params: reminderParam, tags: ['reminders'] } },
    async (req): Promise<InvoiceDto> => {
      const { id, reminderId } = req.params as { id: string; reminderId: string };
      const auth = req.auth!;
      return withTenant(auth.tenantId, async (tx) => {
        const n = await tx.execute(
          `UPDATE reminders SET status = 'skipped', last_error = 'cancelled by user' WHERE id = $1 AND invoice_id = $2 AND status IN ('pending','failed')`,
          [reminderId, id],
        );
        if (!n) throw notFound('Pending reminder');
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'reminder.cancelled',
          entityType: 'reminder',
          entityId: reminderId,
          ip: req.ip,
        });
        return loadInvoiceDto(tx, id);
      });
    },
  );
};
