# Case study — DueNudge

> Use this as the portfolio page. Replace the metrics section with real numbers after two weeks of traffic.

## Problem

Freelancers lose money to late payments, not to lack of work. Chasing invoices is uncomfortable, easy to
postpone, and tone-sensitive: the same message that nudges a good client can annoy them. Existing tools
either do invoicing *or* reminders, and none of them draft the follow-up with any knowledge of the
account.

## Solution

A narrow B2B SaaS: create an invoice, send it, and DueNudge sends well-timed reminders in the tenant's
timezone, stops the moment a payment is recorded, and drafts the firm follow-ups with an LLM that knows
the client's payment history. Multi-tenant, with team roles, Stripe billing and an audit log.

## What was hard (and how it was solved)

| Problem | Decision | Where |
|---|---|---|
| A forgotten `WHERE tenant_id` leaks data | Postgres RLS with `FORCE`, app role has `NOBYPASSRLS`; a failing test proves it | ADR 0001, `rls.test.ts` |
| Stripe delivers at-least-once, out of order | `stripe_events` dedupe PK + per-subscription `last_event_at` guard, all in one transaction | ADR 0002, `webhook.test.ts` |
| Stolen refresh tokens | Rotation with family-level reuse detection | ADR 0003, `auth.test.ts` |
| Two workers send the same reminder | Claim with a conditional `UPDATE … WHERE status='pending' RETURNING` | `processors.ts` |
| Job enqueued, transaction rolled back | Outbox row in the tx, enqueue in an `onCommit` hook, sweeper job for the gap | `email/service.ts` |
| Plan limits raced by concurrent requests | Monthly counters via `UPSERT … RETURNING`; total counters behind an advisory lock | `usage/service.ts`, `limits.test.ts` |
| LLM reminders that sound like a bot | Prompt includes days late, avg days-to-pay, reminders already sent; structured output; per-tenant cost accounting | `ai/draft-reminder.ts` |

## Architecture

See `docs/ARCHITECTURE.md` (diagram) — Next.js 16 → Fastify 5 API → Postgres 16 (RLS) + Redis/BullMQ
workers → Resend/Stripe/Claude.

## Metrics (fill in)

| Metric | Value |
|---|---|
| Signup → first invoice sent (median) | _ min |
| p95 API latency (dashboard summary) | _ ms |
| Reminder delivery success | _ % |
| Infra cost per tenant / month | $_ |
| Test suite | 53 tests, 8 s, real Postgres |

## What I would do differently

- Collect payments in-product (Stripe Connect) instead of a pasted payment link.
- Move plan limits into a `entitlements` table so pricing changes do not need a deploy.
- Add a deny-list for access tokens to make revocation instant instead of ≤15 min.
