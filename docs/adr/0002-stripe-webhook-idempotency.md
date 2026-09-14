# ADR 0002 — Idempotent, order-tolerant Stripe webhooks

**Status:** accepted · **Date:** 2026-09-06

## Context

Stripe delivers webhooks **at least once** and **not necessarily in order**. Real failure modes seen in
production systems:

- The handler succeeds but the 200 is lost on the network → Stripe retries → subscription updated twice
  (harmless) or a "payment failed" email sent twice (not harmless).
- `customer.subscription.updated` (plan → business) and a delayed retry of an older
  `customer.subscription.updated` (plan → pro) arrive out of order → tenant silently downgraded.
- The handler crashes halfway (DB write done, email enqueue not) → partial state.

## Decision

`backend/src/modules/billing/webhook.ts` processes every event inside **one system transaction**:

1. `INSERT INTO stripe_events (id, …) ON CONFLICT (id) DO NOTHING`. Zero rows inserted ⇒ we have seen
   this event ⇒ return `duplicate` without touching anything.
2. For subscription events, lock the tenant's `subscriptions` row (`FOR UPDATE`) and compare
   `event.created` with `last_event_at`. Older ⇒ return `stale`.
3. Apply the change; enqueue any email via the transactional outbox (`email_log` row + `onCommit` hook).

Because (1) and (3) are in the same transaction, a crash in (3) rolls back (1): Stripe's retry is then
processed as a first delivery. Because the outbox row commits with the state change and the queue job is
added only after commit, an email is never sent for a change that did not happen.

The webhook route is an encapsulated Fastify plugin with a raw-body content-type parser, so
`stripe.webhooks.constructEvent` can verify the signature against the exact bytes Stripe sent.

## Consequences

- Effect is exactly-once even though delivery is at-least-once. Covered by
  `backend/test/integration/webhook.test.ts` (duplicate, stale, rollback-then-retry, payment failed).
- `stripe_events` grows by one small row per event; it doubles as an audit trail of everything Stripe
  told us. Prune rows older than 90 days if it matters.
- The local `subscriptions` row is a cache of Stripe's truth. Plan changes initiated by us
  (`POST /billing/change-plan`) do **not** update the local row directly — they call Stripe and wait for
  the webhook, so there is one writer.
