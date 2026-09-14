import { z } from 'zod';
import { PLAN_IDS } from './plans.js';

// ─── Primitives ──────────────────────────────────────────────────────────────
export const uuid = z.uuid();
export const email = z
  .email()
  .max(254)
  .transform((s) => s.trim().toLowerCase());
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), 'Use at least one letter and one number');
export const isoDate = z.iso.date();
export const currency = z
  .string()
  .length(3)
  .transform((c) => c.toUpperCase());
export const money = z.number().int().nonnegative();

export const ROLES = ['owner', 'admin', 'member'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const INVOICE_STATUSES = ['draft', 'sent', 'viewed', 'overdue', 'paid', 'void'] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const REMINDER_TONES = ['friendly', 'firm', 'final_notice'] as const;
export const reminderToneSchema = z.enum(REMINDER_TONES);
export type ReminderTone = z.infer<typeof reminderToneSchema>;

export const planIdSchema = z.enum(PLAN_IDS);

// ─── Auth ────────────────────────────────────────────────────────────────────
export const signupSchema = z.object({
  email,
  password,
  name: z.string().trim().min(1).max(100),
  tenantName: z.string().trim().min(1).max(100).optional(),
  inviteToken: z.string().min(20).max(200).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const switchTenantSchema = z.object({ tenantId: uuid });

// ─── Tenant ──────────────────────────────────────────────────────────────────
export const reminderOffsetsSchema = z
  .array(z.number().int().min(-30).max(90))
  .min(1)
  .max(8)
  .refine((a) => new Set(a).size === a.length, 'Offsets must be unique');

export const updateTenantSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  currency: currency.optional(),
  timezone: z.string().min(1).max(64).optional(),
  businessEmail: email.nullable().optional(),
  businessAddress: z.string().max(500).nullable().optional(),
  logoUrl: z.url().max(500).nullable().optional(),
  reminderOffsets: reminderOffsetsSchema.optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(120).optional(),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const logoUploadSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
});

// ─── Team ────────────────────────────────────────────────────────────────────
export const createInviteSchema = z.object({ email, role: z.enum(['admin', 'member']) });
export const updateMemberSchema = z.object({ role: z.enum(['admin', 'member']) });

// ─── Clients ─────────────────────────────────────────────────────────────────
export const clientInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  company: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(120).optional(),
});
export type ClientInput = z.infer<typeof clientInputSchema>;
export const updateClientSchema = clientInputSchema.partial();

// ─── Invoices ────────────────────────────────────────────────────────────────
export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitCents: money,
});
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

export const invoiceInputSchema = z
  .object({
    clientId: uuid,
    issueDate: isoDate,
    dueDate: isoDate,
    currency: currency.optional(),
    taxRateBps: z.number().int().min(0).max(10_000).default(0),
    notes: z.string().max(2000).nullable().optional(),
    paymentLink: z.url().max(500).nullable().optional(),
    items: z.array(invoiceItemSchema).min(1).max(100),
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    message: 'Due date must be on/after issue date',
    path: ['dueDate'],
  });
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

export const recordPaymentSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  paidAt: isoDate.optional(),
  method: z.enum(['bank_transfer', 'card', 'cash', 'paypal', 'other']).default('bank_transfer'),
  note: z.string().max(500).nullable().optional(),
});

export const listInvoicesQuerySchema = z.object({
  status: invoiceStatusSchema.optional(),
  clientId: uuid.optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const listClientsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  includeArchived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ─── Reminders / AI ──────────────────────────────────────────────────────────
export const aiDraftSchema = z.object({ tone: reminderToneSchema });
export const sendReminderNowSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

// ─── Billing ─────────────────────────────────────────────────────────────────
export const checkoutSchema = z.object({ plan: z.enum(['pro', 'business']) });
export const changePlanSchema = z.object({ plan: planIdSchema });

// ─── Admin ───────────────────────────────────────────────────────────────────
export const adminTenantsQuerySchema = paginationSchema.extend({
  q: z.string().max(100).optional(),
});
