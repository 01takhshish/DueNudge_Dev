# Runbook

Operational notes for whoever is on call. Everything here is reachable without SSH-ing into a box.

## Services

| Process | Entry | Scales | Depends on |
|---|---|---|---|
| `api` | `node dist/server.js` | horizontally, stateless | Postgres, Redis |
| `worker` | `node dist/worker.js` | horizontally (BullMQ locks jobs) | Postgres, Redis, email provider |
| `web` | Next.js standalone | horizontally | `api` |

Health: `GET /health` (liveness, no deps) · `GET /ready` (Postgres + Redis, 2 s timeouts, 503 when degraded).
OpenAPI: `GET /docs`.

## Dashboards & signals

- **Logs** are JSON (pino) with `reqId`, `userId`, `tenantId`. Every error response carries `requestId`
  — ask the user for it, grep the logs.
- **Sentry** receives unhandled API errors and failed jobs (tagged `queue`, `job`).
- **Queues**: BullMQ in Redis. Inspect with `npx bullmq` tooling or `redis-cli KEYS 'bull:*'`.
  Queues: `email`, `reminders`, `maintenance`.
- **Email**: `email_log` table. `status='failed'` after 5 attempts. Admin overview shows failed count (7d).

## Common incidents

### Reminders not going out
1. `SELECT count(*) FROM reminders WHERE status='pending' AND scheduled_for < now()` — backlog?
2. Is the worker running? It logs `worker started` and registers the `scan-due-reminders` scheduler every boot.
3. `redis-cli` → `ZCARD bull:reminders:delayed` / `LLEN bull:reminders:wait`. If Redis was wiped, restart the worker (re-registers schedulers via `upsertJobScheduler`, idempotent).
4. Worst case: `UPDATE reminders SET status='pending' WHERE status='sending' AND updated_at < now() - interval '1 hour'` (a worker died mid-send; the claim is a conditional UPDATE so this is safe).

### Emails stuck in `queued`
The `requeue-stale-emails` maintenance job re-enqueues rows older than 5 min every 5 min. If the provider is down they will move to `failed` after 5 attempts (exponential backoff, ~2.5 min total). To retry failed ones after the provider recovers:
```sql
UPDATE email_log SET status='queued', attempts=0 WHERE status='failed' AND created_at > now() - interval '1 day';
```

### Stripe webhook failures
Stripe dashboard → Developers → Webhooks shows failed deliveries. Our handler returns 400 on bad signatures (check `STRIPE_WEBHOOK_SECRET` matches the endpoint) and 5xx on DB errors (Stripe retries for 3 days). Replays are safe: `stripe_events.id` is the idempotency key. To see what we applied:
```sql
SELECT id, type, event_created, processed_at FROM stripe_events ORDER BY processed_at DESC LIMIT 20;
```

### Tenant claims they see another tenant's data
Treat as P1. RLS makes this structurally unlikely; check whether the report is actually a *shared user* in two workspaces (workspace switcher). Verify policies are still forced:
```sql
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('invoices','clients');
```
and that the app connects as `duenudge_app` (`SELECT current_user`).

### Suspend an abusive tenant
Platform admin → Tenants → Suspend. Revokes all their refresh tokens; access expires within 15 minutes. Their reminder jobs are skipped by the scheduler (`t.suspended_at IS NULL` filter).

## Deploy & rollback

- CI deploys on merge to `main` (Fly.io for api/worker with `release_command = migrate`, Vercel for web).
- Migrations are forward-only. Roll back by deploying the previous image; write a new migration to undo schema changes if needed.
- `flyctl releases` / `flyctl deploy --image <previous>`.

## Backups
Managed Postgres daily snapshots (Fly Postgres / Neon / RDS). Test a restore quarterly: restore to a scratch DB, run `SELECT count(*) FROM invoices`.
