import type { FastifyPluginAsync } from 'fastify';
import type { z } from 'zod';
import { PLANS, changePlanSchema, checkoutSchema, type BillingDto } from '@duenudge/shared';
import { config } from '../../config.js';
import { withSystem, withTenant } from '../../db/tx.js';
import { AppError, badRequest, conflict } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { getSubscription, getUsage } from '../usage/service.js';
import { priceIdForPlan, stripe } from './stripe.js';
import { processStripeEvent } from './webhook.js';

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { schema: { tags: ['billing'] } }, async (req): Promise<BillingDto> => {
    const auth = req.auth!;
    return withTenant(auth.tenantId, async (tx) => {
      const subscription = await getSubscription(tx, auth.tenantId);
      const usage = await getUsage(tx, auth.tenantId, subscription.effectivePlan);
      return {
        subscription,
        usage,
        prices: { pro: PLANS.pro.priceMonthlyUsd, business: PLANS.business.priceMonthlyUsd },
      };
    });
  });

  /** Start a Stripe Checkout session (new subscribers). Trial applies once, on the first subscription. */
  app.post(
    '/checkout',
    { preHandler: app.requireRole('owner'), schema: { body: checkoutSchema, tags: ['billing'] } },
    async (req) => {
      const { plan } = req.body as z.infer<typeof checkoutSchema>;
      const auth = req.auth!;
      const { customerId, hadSubscription, email, tenantName } = await withSystem(async (tx) => {
        const t = await tx.one<{ stripe_customer_id: string | null; name: string }>(
          `SELECT stripe_customer_id, name FROM tenants WHERE id = $1`,
          [auth.tenantId],
        );
        const s = await tx.maybeOne<{ stripe_subscription_id: string | null; status: string }>(
          `SELECT stripe_subscription_id, status FROM subscriptions WHERE tenant_id = $1`,
          [auth.tenantId],
        );
        if (s?.stripe_subscription_id && s.status !== 'canceled')
          throw conflict(
            'You already have an active subscription. Use "Change plan" instead.',
            'ALREADY_SUBSCRIBED',
          );
        const u = await tx.one<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
          auth.userId,
        ]);
        let customerId = t.stripe_customer_id;
        if (!customerId) {
          const customer = await stripe().customers.create({
            email: u.email,
            name: t.name,
            metadata: { tenant_id: auth.tenantId },
          });
          customerId = customer.id;
          await tx.execute(`UPDATE tenants SET stripe_customer_id = $2 WHERE id = $1`, [
            auth.tenantId,
            customerId,
          ]);
        }
        return {
          customerId,
          hadSubscription: Boolean(s?.stripe_subscription_id),
          email: u.email,
          tenantName: t.name,
        };
      });

      const session = await stripe().checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: auth.tenantId,
        line_items: [{ price: priceIdForPlan(plan), quantity: 1 }],
        allow_promotion_codes: true,
        success_url: `${config.APP_URL}/app/settings/billing?checkout=success`,
        cancel_url: `${config.APP_URL}/app/settings/billing?checkout=cancelled`,
        subscription_data: {
          metadata: { tenant_id: auth.tenantId, tenant_name: tenantName, owner_email: email },
          ...(hadSubscription || config.STRIPE_TRIAL_DAYS <= 0
            ? {}
            : { trial_period_days: config.STRIPE_TRIAL_DAYS }),
        },
      });
      await withSystem((tx) =>
        audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'billing.checkout_started',
          entityType: 'subscription',
          metadata: { plan },
          ip: req.ip,
        }),
      );
      return { url: session.url };
    },
  );

  /** Stripe Customer Portal: update card, cancel, view invoices. */
  app.post(
    '/portal',
    { preHandler: app.requireRole('owner'), schema: { tags: ['billing'] } },
    async (req) => {
      const auth = req.auth!;
      const t = await withSystem((tx) =>
        tx.one<{ stripe_customer_id: string | null }>(
          `SELECT stripe_customer_id FROM tenants WHERE id = $1`,
          [auth.tenantId],
        ),
      );
      if (!t.stripe_customer_id)
        throw badRequest('No billing account yet — start a subscription first');
      const session = await stripe().billingPortal.sessions.create({
        customer: t.stripe_customer_id,
        return_url: `${config.APP_URL}/app/settings/billing`,
      });
      return { url: session.url };
    },
  );

  /** Upgrade/downgrade an existing subscription in place, with proration. Downgrade to free = cancel at period end. */
  app.post(
    '/change-plan',
    { preHandler: app.requireRole('owner'), schema: { body: changePlanSchema, tags: ['billing'] } },
    async (req) => {
      const { plan } = req.body as z.infer<typeof changePlanSchema>;
      const auth = req.auth!;
      const sub = await withSystem((tx) =>
        tx.maybeOne<{ stripe_subscription_id: string | null; plan: string; status: string }>(
          `SELECT stripe_subscription_id, plan, status FROM subscriptions WHERE tenant_id = $1`,
          [auth.tenantId],
        ),
      );
      if (!sub?.stripe_subscription_id || sub.status === 'canceled')
        throw conflict(
          'No active subscription to change. Start one with checkout.',
          'NO_SUBSCRIPTION',
        );
      if (sub.plan === plan) throw badRequest('You are already on that plan');

      const current = await stripe().subscriptions.retrieve(sub.stripe_subscription_id);
      const item = current.items.data[0];
      if (!item) throw new AppError(500, 'STRIPE_STATE', 'Subscription has no items');

      if (plan === 'free') {
        await stripe().subscriptions.update(sub.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      } else {
        await stripe().subscriptions.update(sub.stripe_subscription_id, {
          items: [{ id: item.id, price: priceIdForPlan(plan) }],
          proration_behavior: 'create_prorations',
          cancel_at_period_end: false,
        });
      }
      // The webhook (customer.subscription.updated) is the source of truth for the local row.
      await withSystem((tx) =>
        audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'billing.plan_change_requested',
          entityType: 'subscription',
          entityId: sub.stripe_subscription_id,
          metadata: { from: sub.plan, to: plan },
          ip: req.ip,
        }),
      );
      return { ok: true, pending: true };
    },
  );
};

/**
 * Registered as a separate encapsulated plugin so it can take the RAW body (needed for signature
 * verification) without affecting JSON parsing anywhere else.
 */
export const stripeWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  app.post(
    '/stripe',
    { config: { rateLimit: false }, schema: { tags: ['billing'] } },
    async (req, reply) => {
      if (!config.stripeEnabled)
        throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'Billing is not configured');
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') throw badRequest('Missing stripe-signature header');
      let event;
      try {
        event = stripe().webhooks.constructEvent(
          req.body as Buffer,
          sig,
          config.STRIPE_WEBHOOK_SECRET!,
        );
      } catch (err) {
        req.log.warn({ err }, 'stripe signature verification failed');
        throw badRequest('Invalid Stripe signature');
      }
      const outcome = await withSystem((tx) => processStripeEvent(tx, event));
      req.log.info({ eventId: event.id, type: event.type, outcome }, 'stripe webhook');
      return reply.send({ received: true, outcome });
    },
  );
};
