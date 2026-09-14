# Contributing

## Workflow
- Branch from `main`, open a PR. CI must be green (lint, format, typecheck, tests, image builds, E2E).
- Squash-merge. Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Anything that changes a schema needs a new forward-only file in `backend/src/db/migrations/`.
- Anything that changes an API contract updates the Zod schema in `packages/shared` (it *is* the contract for both the API and the web app).

## Local checks
```bash
npm run lint && npm run format:check && npm run typecheck && npm test
```
Integration tests need Postgres on `localhost:5433` (`docker compose up -d postgres`).

## Where things go
| Concern | Location |
|---|---|
| Request validation / DTO types | `packages/shared/src/schemas.ts`, `types.ts` |
| Route handlers | `backend/src/modules/<area>/routes.ts` |
| Business logic reused by workers | `backend/src/modules/<area>/service.ts` |
| Background jobs | `backend/src/jobs/processors.ts` (registered in `worker.ts`) |
| Emails | `backend/src/email/templates.ts` (pure functions) |
| Web pages | `frontend/app/**` (server components), interactive bits in `frontend/components/*` (`'use client'`) |

## Rules of the road
1. Tenant data is only ever read or written inside `withTenant(...)`. `withSystem(...)` needs a comment saying why.
2. Every mutation writes an `audit(...)` row in the same transaction.
3. Never enqueue a job inside a transaction — use `tx.onCommit(...)`.
4. Money is integer cents. No floats reach the database.
5. New plan-limited resources call `assertWithinLimit` before the insert, in the same transaction.
