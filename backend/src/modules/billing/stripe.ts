import Stripe from 'stripe';
import type { PlanId } from '@duenudge/shared';
import { config } from '../../config.js';
import { AppError } from '../../lib/errors.js';

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!config.stripeEnabled)
    throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'Billing is not configured on this server');
  if (!client) client = new Stripe(config.STRIPE_SECRET_KEY!, { typescript: true });
  return client;
}

export function priceIdForPlan(plan: 'pro' | 'business'): string {
  const id = plan === 'pro' ? config.STRIPE_PRICE_PRO : config.STRIPE_PRICE_BUSINESS;
  if (!id)
    throw new AppError(
      503,
      'BILLING_NOT_CONFIGURED',
      `No Stripe price configured for the ${plan} plan`,
    );
  return id;
}

export function planForPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return 'free';
  if (priceId === config.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === config.STRIPE_PRICE_BUSINESS) return 'business';
  return 'free';
}

export type StripeEvent = Stripe.Event;
export type StripeSubscription = Stripe.Subscription;
