import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { ReminderTone } from '@duenudge/shared';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { formatMoney } from '../lib/money.js';

/**
 * The one AI feature: draft a payment-reminder email that actually knows the account.
 * It is given the invoice, the client's payment history with this business, and how many nudges
 * have already gone out — so a "firm" reminder to a chronically-late client reads differently
 * from a first friendly nudge to someone who always pays early.
 */
export interface DraftContext {
  tone: ReminderTone;
  businessName: string;
  senderName: string;
  client: { name: string; company: string | null };
  invoice: {
    number: string;
    currency: string;
    totalCents: number;
    amountPaidCents: number;
    issueDate: string;
    dueDate: string;
    daysOverdue: number;
    paymentLink: string | null;
  };
  history: {
    paidInvoices: number;
    avgDaysToPay: number | null;
    lateInvoices: number;
    remindersAlreadySent: number;
    lastReminderAt: string | null;
  };
}

export interface DraftResult {
  subject: string;
  body: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

const DraftSchema = z.object({
  subject: z.string().describe('Email subject line, under 80 characters, no emoji'),
  body: z
    .string()
    .describe(
      'Plain-text email body. Greeting, 1-3 short paragraphs, sign-off with the sender name. No subject line, no placeholders, no markdown.',
    ),
});

// USD per million tokens for cost accounting (claude-opus-5). Update if AI_MODEL changes.
const PRICE_PER_MTOK = { input: 5, output: 25 };

const TONE_GUIDE: Record<ReminderTone, string> = {
  friendly:
    'Warm and light. Assume good faith — this may simply have slipped their mind. One gentle ask.',
  firm: 'Polite but direct. State the overdue amount and days late plainly, ask for a payment date, and mention this is a follow-up if reminders were already sent.',
  final_notice:
    'Formal and unambiguous. Make clear this is the final reminder before further action (paused work / late fees per the agreement). Still professional; never threatening or rude.',
};

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

export function buildPrompt(ctx: DraftContext): string {
  const balance = formatMoney(
    ctx.invoice.totalCents - ctx.invoice.amountPaidCents,
    ctx.invoice.currency,
  );
  const lines = [
    `Business: ${ctx.businessName} (sender signs as "${ctx.senderName}")`,
    `Client: ${ctx.client.name}${ctx.client.company ? ` at ${ctx.client.company}` : ''}`,
    `Invoice ${ctx.invoice.number}: balance ${balance}, issued ${ctx.invoice.issueDate}, due ${ctx.invoice.dueDate}`,
    ctx.invoice.daysOverdue > 0
      ? `Status: ${ctx.invoice.daysOverdue} days overdue`
      : ctx.invoice.daysOverdue === 0
        ? 'Status: due today'
        : `Status: due in ${-ctx.invoice.daysOverdue} days`,
    ctx.invoice.amountPaidCents > 0
      ? `Partially paid: ${formatMoney(ctx.invoice.amountPaidCents, ctx.invoice.currency)} received so far`
      : null,
    ctx.invoice.paymentLink
      ? 'A "pay online" link will be appended automatically below the body — do not invent a URL.'
      : 'Payment details are on the invoice page linked below the body — do not invent bank details.',
    `Relationship: ${ctx.history.paidInvoices} previously paid invoices` +
      (ctx.history.avgDaysToPay !== null
        ? `, typically pays ${ctx.history.avgDaysToPay} days after issue`
        : '') +
      (ctx.history.lateInvoices > 0
        ? `, ${ctx.history.lateInvoices} paid late`
        : ', no late payments on record'),
    `Reminders already sent for this invoice: ${ctx.history.remindersAlreadySent}${ctx.history.lastReminderAt ? ` (last on ${ctx.history.lastReminderAt.slice(0, 10)})` : ''}`,
    '',
    `Tone: ${ctx.tone.replace('_', ' ')} — ${TONE_GUIDE[ctx.tone]}`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

const SYSTEM = `You write payment-reminder emails on behalf of freelancers and small studios. Write like a considerate human who wants to keep the client relationship, not a collections agency. Be specific (amount, invoice number, due date), short, and end with a clear next step. Never fabricate details that were not provided. Return the subject and plain-text body in the requested format.`;

export async function draftReminder(ctx: DraftContext): Promise<DraftResult> {
  if (!config.aiEnabled)
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI drafting is not configured on this server');
  const model = config.AI_MODEL;
  let response;
  try {
    response = await anthropic().messages.parse({
      model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(ctx) }],
      output_config: { format: zodOutputFormat(DraftSchema), effort: 'low' },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError)
      throw new AppError(429, 'AI_RATE_LIMITED', 'AI drafting is busy, try again in a moment');
    if (err instanceof Anthropic.APIError)
      throw new AppError(502, 'AI_UPSTREAM_ERROR', `AI provider error (${err.status})`);
    throw err;
  }
  if (response.stop_reason === 'refusal')
    throw new AppError(422, 'AI_REFUSED', 'The model declined to draft this reminder');
  const parsed = response.parsed_output;
  if (!parsed) throw new AppError(502, 'AI_BAD_OUTPUT', 'The model returned an unparseable draft');
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costMicros = Math.round(
    inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output,
  );
  return {
    subject: parsed.subject.trim(),
    body: parsed.body.trim(),
    model: response.model,
    inputTokens,
    outputTokens,
    costMicros,
  };
}
