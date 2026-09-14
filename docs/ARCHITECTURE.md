# Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js 16 app<br/>App Router · Tailwind]
  end
  subgraph Web["Vercel / container"]
    PROXY[proxy.ts<br/>cookie refresh + route guard]
    RSC[Server components<br/>fetch with cookies]
  end
  subgraph API["Fastify 5 API (stateless)"]
    AUTH[auth plugin<br/>JWT → req.auth]
    VAL[Zod validation<br/>+ OpenAPI]
    MOD[modules<br/>auth · clients · invoices · reminders · billing · team · admin]
    TX[withTenant / withSystem<br/>SET LOCAL app.tenant_id]
  end
  subgraph Data
    PG[(Postgres 16<br/>RLS on every tenant table)]
    REDIS[(Redis<br/>BullMQ queues)]
  end
  subgraph Worker["Worker (BullMQ)"]
    W1[send-email]
    W2[scan-due-reminders ⏱ 15m]
    W3[send-reminder]
    W4[mark-overdue ⏱ daily]
    W5[requeue-stale-emails ⏱ 5m]
  end
  subgraph External
    STRIPE[Stripe]
    RESEND[Resend / SMTP]
    CLAUDE[Claude API]
    S3[S3 / R2]
  end

  UI -- "/api/* (same-origin runtime proxy route)" --> API
  UI --> PROXY --> RSC --> API
  AUTH --> VAL --> MOD --> TX --> PG
  MOD -- "onCommit → enqueue" --> REDIS
  REDIS --> W1 & W2 & W3 & W4 & W5
  W1 --> RESEND
  W2 --> W3
  W3 -- outbox row --> PG
  STRIPE -- webhook (raw body, signed) --> MOD
  MOD -- checkout / portal / update --> STRIPE
  MOD -- structured output --> CLAUDE
  MOD -- presigned PUT --> S3
```

## Request lifecycle (authenticated write)

1. Browser calls `POST /api/v1/invoices` (same origin). The Next.js proxy route forwards it to the API, cookies included.
2. `authPlugin` verifies the `dn_access` JWT → `req.auth = { userId, tenantId, role }`.
3. Zod validates the body (coercion, defaults) and the same schema documents the endpoint in OpenAPI.
4. Handler opens `withTenant(tenantId)`: `BEGIN; SET LOCAL app.tenant_id = …`. Every query in the
   transaction is filtered by RLS.
5. Plan limit check (`assertWithinLimit`) inside the same transaction; a `PlanLimitError` rolls back and
   returns `402 PLAN_LIMIT_REACHED`, which the web app turns into an upgrade modal.
6. Audit row written in the same transaction. Emails are written to `email_log` (outbox) and the queue
   job is added in an `onCommit` hook.
7. `COMMIT` → hooks run → BullMQ job → worker → email provider → `email_log.status = sent`.

## Storage per access pattern

| Data | Store | Why |
|---|---|---|
| Tenants, users, invoices, reminders, audit | Postgres | Relational, transactional, RLS |
| Job queue, schedulers, per-job dedupe | Redis (BullMQ) | Delayed jobs, retries with backoff, locks |
| Tenant logos | S3 / R2 via presigned PUT | Bytes never transit the API |
| Stripe subscription state | Postgres cache of Stripe (webhooks are the writer) | One source of truth |

## Money
Integers only. `*_cents BIGINT`, tax in basis points, `numeric(12,2)` quantities. Rounding happens once per line.

## Failure modes considered
- Worker dies mid-reminder → conditional-UPDATE claim + BullMQ retry; the `sending` state is recoverable (runbook).
- API dies after COMMIT but before enqueue → `requeue-stale-emails` sweeper.
- Stripe replays / reorders → dedupe table + `last_event_at`.
- Redis wiped → schedulers re-registered on worker boot (`upsertJobScheduler`); pending reminders are in Postgres, not Redis.
- Postgres down → `/ready` returns 503, load balancer stops routing; jobs fail and retry.
