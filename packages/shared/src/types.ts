import type { Metric, PlanId } from './plans.js';
import type { InvoiceStatus, Role } from './schemas.js';

/** Consistent error envelope returned by every API error response. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
    /** Present when code === 'PLAN_LIMIT_REACHED' */
    limit?: { metric: Metric; limit: number; current: number; plan: PlanId };
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export interface TenantDto {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  businessEmail: string | null;
  businessAddress: string | null;
  logoUrl: string | null;
  reminderOffsets: number[];
  defaultPaymentTermsDays: number;
  onboardedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

export interface SubscriptionDto {
  plan: PlanId;
  effectivePlan: PlanId;
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid';
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
}

export interface UsageDto {
  period: string;
  metrics: Record<Metric, { used: number; limit: number | null }>;
}

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  role: Role;
}

export interface MeDto {
  user: UserDto;
  tenant: TenantDto;
  role: Role;
  memberships: MembershipSummary[];
  subscription: SubscriptionDto;
  usage: UsageDto;
}

export interface ClientDto {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  paymentTermsDays: number;
  archivedAt: string | null;
  createdAt: string;
  outstandingCents: number;
  overdueCents: number;
  invoiceCount: number;
  avgDaysToPay: number | null;
}

export interface InvoiceItemDto {
  id: string;
  description: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface PaymentDto {
  id: string;
  amountCents: number;
  paidAt: string;
  method: string;
  note: string | null;
}

export interface ReminderDto {
  id: string;
  kind: 'before_due' | 'on_due' | 'overdue' | 'manual';
  offsetDays: number | null;
  scheduledFor: string;
  status: 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  subject: string | null;
}

export interface InvoiceSummaryDto {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  amountPaidCents: number;
  clientId: string;
  clientName: string;
  sentAt: string | null;
  viewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface InvoiceDto extends InvoiceSummaryDto {
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  notes: string | null;
  paymentLink: string | null;
  publicUrl: string | null;
  clientEmail: string;
  items: InvoiceItemDto[];
  payments: PaymentDto[];
  reminders: ReminderDto[];
  drafts: AiDraftDto[];
}

export interface AiDraftDto {
  id: string;
  tone: string;
  subject: string;
  body: string;
  model: string;
  createdAt: string;
}

export interface PublicInvoiceDto {
  number: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string;
  dueDate: string;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  notes: string | null;
  paymentLink: string | null;
  items: InvoiceItemDto[];
  business: { name: string; email: string | null; address: string | null; logoUrl: string | null };
  client: { name: string; company: string | null; address: string | null };
}

export interface DashboardDto {
  currency: string;
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  paidThisMonthCents: number;
  draftCount: number;
  upcomingReminders: Array<{
    id: string;
    invoiceId: string;
    invoiceNumber: string;
    clientName: string;
    scheduledFor: string;
    kind: string;
  }>;
  recentActivity: AuditEntryDto[];
}

export interface AuditEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TeamDto {
  members: Array<{ userId: string; name: string; email: string; role: Role; joinedAt: string }>;
  invites: Array<{ id: string; email: string; role: Role; expiresAt: string; createdAt: string }>;
}

export interface BillingDto {
  subscription: SubscriptionDto;
  usage: UsageDto;
  prices: Record<'pro' | 'business', number>;
}
