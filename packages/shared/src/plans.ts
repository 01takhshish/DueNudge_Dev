/**
 * Plan catalogue. The API enforces these server-side; the web app only uses them for display.
 * `null` means unlimited.
 */
export const PLAN_IDS = ['free', 'pro', 'business'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const METRICS = ['clients', 'invoices', 'members', 'ai_drafts'] as const;
export type Metric = (typeof METRICS)[number];

/** Which metrics reset every calendar month vs. count live rows. */
export const METRIC_KIND: Record<Metric, 'monthly' | 'total'> = {
  clients: 'total',
  invoices: 'monthly',
  members: 'total',
  ai_drafts: 'monthly',
};

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMonthlyUsd: number;
  tagline: string;
  limits: Record<Metric, number | null>;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthlyUsd: 0,
    tagline: 'For trying it out',
    limits: { clients: 3, invoices: 5, members: 1, ai_drafts: 0 },
    features: ['3 clients', '5 invoices / month', 'Automatic reminders', 'Public invoice pages'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthlyUsd: 19,
    tagline: 'For working freelancers',
    limits: { clients: null, invoices: null, members: 3, ai_drafts: 100 },
    features: [
      'Unlimited clients & invoices',
      '3 team members',
      '100 AI-drafted reminders / month',
      'Custom reminder schedule',
      'Audit log',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    priceMonthlyUsd: 49,
    tagline: 'For studios and agencies',
    limits: { clients: null, invoices: null, members: 10, ai_drafts: 1000 },
    features: [
      'Everything in Pro',
      '10 team members',
      '1,000 AI-drafted reminders / month',
      'Priority support',
    ],
  },
};

export const PAID_PLANS: PlanId[] = ['pro', 'business'];

export function planRank(plan: PlanId): number {
  return PLAN_IDS.indexOf(plan);
}

export function isPaidPlan(plan: PlanId): boolean {
  return PAID_PLANS.includes(plan);
}
