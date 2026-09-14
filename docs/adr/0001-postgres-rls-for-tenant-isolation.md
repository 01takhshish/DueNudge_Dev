# ADR 0001 — Postgres row-level security for tenant isolation

**Status:** accepted · **Date:** 2026-09-06

## Context

Every tenant-owned row lives in shared tables (`clients`, `invoices`, …) with a `tenant_id` column. The
classic failure mode of multi-tenant SaaS is a single query that forgets `WHERE tenant_id = $1` — and it
is a failure mode that unit tests rarely catch because the bug only manifests with *another* tenant's data
present.

Options considered:

1. **Discipline only** — every query filters by tenant; reviewers check. Cheap, but one missed clause is a
   cross-tenant data leak, and the codebase already has ~60 queries.
2. **Schema-per-tenant** — strong isolation, but migrations become O(tenants), connection pooling gets
   awkward, and cross-tenant admin queries need dynamic SQL.
3. **Postgres RLS** — policies on each tenant table compare `tenant_id` to a per-transaction setting. The
   database enforces the filter even when the application forgets it.

## Decision

Option 3. Concretely:

- The API and workers connect as `duenudge_app`, a role that is **not** the table owner and has
  `NOBYPASSRLS`. Migrations run as the owner (`DATABASE_URL` vs `DATABASE_APP_URL`).
- Each tenant table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and two policies:
  - `tenant_isolation`: `USING/WITH CHECK (tenant_id = current_tenant_id())`
  - `system_bypass`: `USING/WITH CHECK (is_system_context())`
- `current_tenant_id()` reads `current_setting('app.tenant_id', true)`; `is_system_context()` reads
  `app.role = 'system'`. Both are set with `SET LOCAL` (transaction-scoped) by exactly two helpers:
  `withTenant(tenantId, fn)` and `withSystem(fn)` in `backend/src/db/tx.ts`.
- Global tables (`users`, `tenants`, `memberships`, `subscriptions`, `stripe_events`, `refresh_tokens`)
  have no RLS. They are touched only by auth, billing and admin code.

`SET LOCAL` matters: it is cleared at `COMMIT`/`ROLLBACK`, so a pooled connection can never carry one
request's tenant into the next. (`SET` without `LOCAL` would be a session-level leak.)

## Consequences

- A query without a tenant filter returns **zero rows** rather than everyone's rows. Verified by
  `backend/test/integration/rls.test.ts` ("cannot see another tenant's rows even without a WHERE clause",
  "cannot INSERT a row tagged with another tenant's id").
- `system_bypass` is a deliberate, greppable back door. Every `withSystem(` call site is one of: auth
  (no tenant yet), Stripe webhooks (addressed by customer id), job schedulers (cross-tenant scans),
  platform admin. The test suite asserts the app role cannot bypass RLS by itself.
- The setting is trusted as much as the connection is: if an attacker can run arbitrary SQL on the app
  connection they can `SET app.role = 'system'`. RLS defends against *application bugs*, not against SQL
  injection — parameterised queries do that.
- Cost: `EXPLAIN` shows the policy predicate as an extra filter that uses the `(tenant_id, …)` indexes;
  no measurable overhead at this scale.
