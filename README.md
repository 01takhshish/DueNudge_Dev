<div align="center">

# DueNudge

**Invoicing + automatic payment reminders for freelancers — a production-grade multi-tenant SaaS.**

Next.js 16 · Fastify 5 · Postgres 16 (row-level security) · Redis/BullMQ · Stripe · Resend · Claude

[Live demo](#) · [Case study](docs/CASE_STUDY.md) · [Architecture](docs/ARCHITECTURE.md) · [ADRs](docs/adr) · [Deploy guide](docs/DEPLOY.md)

</div>

> Portfolio project #2 from the roadmap: *"a real, narrow, boring-on-purpose B2B SaaS that a real business would pay for"*. The point is not the feature list — it is the tenancy, billing, auth, jobs, observability and tests underneath it.

## What it does

A freelancer creates a client and an invoice. On **Send**, the client gets an email with a public invoice
link, and DueNudge schedules reminders (e.g. 3 days before due, on the due date, 3/7/14 days after) at
9 AM in the freelancer's timezone. Reminders stop the moment a payment is recorded. When a client goes
quiet, one click drafts a *firm* or *final notice* email with Claude, using the client's real payment
history — then sends it. Teams get roles and an audit log; billing is Stripe with a 14-day trial, proration,
and plan limits enforced server-side.

## The checklist (from the roadmap) and where each item lives

| Non-negotiable | Implementation | Proof |
|---|---|---|
| Multi-tenancy with hard row-level isolation | Postgres RLS, `FORCE`, app role `NOBYPASSRLS`; `withTenant()` sets `app.tenant_id` per transaction | [`rls.test.ts`](backend/test/integration/rls.test.ts) — "tenant A cannot read tenant B" (and cannot insert/update/delete), [ADR 0001](docs/adr/0001-postgres-rls-for-tenant-isolation.md) |
| Auth: email + OAuth, refresh tokens, RBAC, invites | scrypt passwords, Google OAuth (hand-rolled), rotating refresh tokens with reuse detection, owner/admin/member, 7-day invites | [`auth.test.ts`](backend/test/integration/auth.test.ts), [ADR 0003](docs/adr/0003-auth-tokens-and-sessions.md) |
| Stripe subscriptions: plans, trials, proration, idempotent webhooks | Checkout + Customer Portal; in-place plan change with `create_prorations`; `stripe_events` dedupe table + out-of-order guard | [`webhook.test.ts`](backend/test/integration/webhook.test.ts), [ADR 0002](docs/adr/0002-stripe-webhook-idempotency.md) |
| Transactional email + background queue with retries | Resend (prod) / Mailpit SMTP (dev); BullMQ with exponential backoff; transactional outbox (`email_log`) + sweeper | [`invoices.test.ts`](backend/test/integration/invoices.test.ts) "delivers exactly once" |
| Usage metering & plan limits, graceful upgrade prompt | `assertWithinLimit()` in the write transaction (UPSERT counters / advisory lock); `402 PLAN_LIMIT_REACHED` → upgrade modal | [`limits.test.ts`](backend/test/integration/limits.test.ts) incl. an 8-way race |
| Admin panel, audit log, onboarding flow | `/admin` (tenants, MRR, AI cost, suspend), `/app/settings/audit`, 3-step `/onboarding` | `admin/routes.ts`, `audit/service.ts` (same-transaction writes) |
| One genuinely useful AI feature | Context-aware reminder drafting (`claude-opus-5`, structured output, per-tenant token + cost accounting, metered per plan) | [`ai/draft-reminder.ts`](backend/src/ai/draft-reminder.ts) |

Plus the quality bar: Zod at every boundary, OpenAPI at `/docs` generated from the same schemas,
structured logs with request ids, `/health` + `/ready`, Sentry + PostHog hooks, rate limiting, helmet,
CSRF-safe cookie auth, explicit indexes, migrations, CI that runs tests against a real Postgres and builds
both images, one Playwright E2E flow.

## Architecture

```
Browser ──/api/*──▶ Next.js 16 (proxy.ts refreshes cookies) ──▶ Fastify API ──▶ Postgres (RLS)
                                                                    │  onCommit          ▲
                                                                    ▼                    │
                                                              Redis / BullMQ ──▶ Worker ─┘──▶ Resend · Stripe · Claude · S3
```
Full diagram, request lifecycle and failure-mode analysis: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
frontend/        Next.js 16 App Router (Tailwind 4). Deploys alone to Vercel in demo mode.
backend/         Fastify API + BullMQ worker (same package, two entrypoints). Needs Postgres + Redis.
packages/shared  Zod schemas, DTO types, plan catalogue — the contract both sides import
infra/           Postgres role bootstrap, Fly.io config
e2e/             Playwright
docs/            ADRs, runbook, case study, deploy guide
```

## Frontend-only live demo (free, on Vercel)

The frontend has a **demo mode** (`NEXT_PUBLIC_DEMO_MODE=true`): an in-memory mock of the API, scoped per visitor, with a
seeded workspace — clients, invoices in every state, reminder history, audit log, billing, admin panel. Every screen works,
every action works (send, pay, void, AI-draft, invite…), nothing is emailed, and data resets on cold start. The landing
page gets a **"Try the live demo"** button that drops visitors straight into the app. No backend, no database, $0/month.
Step-by-step: [docs/DEPLOY.md](docs/DEPLOY.md).

## Run it locally (< 5 minutes)

Prereqs: Node 22+, Docker.

```bash
git clone <repo> duenudge && cd duenudge
npm install
cp .env.example .env                      # defaults work out of the box; root scripts load it for every app
docker compose up -d postgres redis mailpit
npm run migrate && npm run seed           # schema + demo data
npm run dev                               # api :4000 · worker · web :3000
```

Open http://localhost:3000 and sign in with a seeded account:

| Account | Password | Role |
|---|---|---|
| `owner@acme.test` | `Password123!` | Owner of "Acme Design Studio" (Pro) |
| `owner@bright.test` | `Password123!` | Owner of "Bright Dev Co" (Pro, EUR) |
| `admin@duenudge.test` | `Password123!` | Platform admin (`/admin`) |

Every email the app sends lands in **Mailpit** at http://localhost:8025. API docs: http://localhost:4000/docs.

> Postgres is exposed on host port **5433** (not 5432) so it never collides with a locally installed Postgres. Override with `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT`. If something else already listens on 4000, change `API_PORT`, `API_PUBLIC_URL` and `API_URL` in `.env` together (e.g. to 4100); likewise `WEB_PORT` + `APP_URL` if 3000 is busy — the web app reads `API_URL` at runtime.

Optional integrations, each enabled by setting its env var: Stripe (`STRIPE_*` + `stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe`), Google sign-in (`GOOGLE_*`), AI drafting (`ANTHROPIC_API_KEY`), logo uploads (`S3_*`), Sentry, PostHog.

Full-stack in containers instead: `docker compose --profile full up --build`.

## Tests

```bash
npm test            # 53 tests: unit + integration against a real Postgres (~8s)
npm run test:e2e    # Playwright, needs the stack running
```

Integration tests reset a `duenudge_test` database and exercise the real HTTP layer (`app.inject`) and the
real worker processors. Redis is mocked; nothing else is. What is tested is deliberately the *failure*
cases: cross-tenant access, token replay, concurrent limit races, duplicate and reordered webhooks,
crash-after-send retries, overpayment.

## Design decisions worth reading

- [ADR 0001 — Postgres RLS for tenant isolation](docs/adr/0001-postgres-rls-for-tenant-isolation.md)
- [ADR 0002 — Idempotent, order-tolerant Stripe webhooks](docs/adr/0002-stripe-webhook-idempotency.md)
- [ADR 0003 — Access/refresh token design](docs/adr/0003-auth-tokens-and-sessions.md)
- [Runbook](docs/RUNBOOK.md) — what to do when reminders stop, emails stick, webhooks fail.

## Known limitations (and what I would do next)

- **Payment collection is a link, not a flow.** Clients pay via a pasted Stripe Payment Link / PayPal URL and the freelancer records the payment. Next: Stripe Connect so "Pay online" settles the invoice automatically via webhook.
- **Access-token revocation lags up to 15 minutes.** Removing a member or suspending a tenant revokes refresh tokens; existing access JWTs live out their TTL. Next: a Redis deny-list keyed by token `jti`, checked in the auth hook.
- **RLS trusts the connection.** The `system_bypass` policy is gated by a GUC the app role can set. It protects against application bugs (missing `WHERE tenant_id`), not against SQL injection on the app connection — parameterised queries do that. Next: move the system paths to `SECURITY DEFINER` functions so the bypass is not settable from the app role at all.
- **No password reset / email verification.** Google sign-in covers the "forgot password" case for now. Next: signed reset tokens through the same outbox.
- **Reminders assume one send hour (9 AM local).** Fine for the product; per-client send windows would need a `send_hour` column and a scheduler tweak.
- **Single region, single Postgres.** The design scales horizontally on API/worker nodes; the database is the ceiling. The reminder scan is an indexed partial-index query (`reminders_due_idx`) and would handle millions of pending reminders, but the nightly overdue flip is one `UPDATE` and should be batched past ~1M open invoices.
- **No PDF rendering.** The public invoice page is print-optimised (Cmd+P → PDF). Puppeteer-based PDFs were left out deliberately to keep the image small; a `pdf` queue job would slot into the existing worker.

## License

MIT
