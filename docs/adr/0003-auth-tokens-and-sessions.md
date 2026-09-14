# ADR 0003 — Short-lived JWT access tokens + rotating opaque refresh tokens

**Status:** accepted · **Date:** 2026-09-06

## Context

Requirements: email/password and Google sign-in; users can belong to several workspaces; roles must be
enforced on every request; a removed member or a suspended tenant must lose access quickly; the Next.js
app renders on the server, so it needs to call the API with the user's identity during SSR.

## Decision

Two httpOnly cookies, set by the API and proxied same-origin by a Next.js route handler (`/api/*`):

| Cookie | Content | TTL | Purpose |
|---|---|---|---|
| `dn_access` | HS256 JWT `{sub, tid, role, pa}` | 15 min | Stateless authz on every request. No DB hit. |
| `dn_refresh` | 48 random bytes (opaque) | 30 days | Stored as SHA-256 in `refresh_tokens`, rotated on use. |

- **Rotation with reuse detection.** Each refresh revokes the presented token and issues a new one in the
  same `family_id`. Presenting an already-revoked token means it was stolen and replayed; the whole family
  is revoked (all devices descended from that login). Note the detecting transaction must *roll back*
  when it throws, so the family revocation happens in a separate transaction (`SessionReuseError`).
- **Revocation lag ≤ 15 min.** Removing a member, changing a role, or suspending a tenant revokes refresh
  tokens; the access JWT keeps working until it expires. Acceptable for this product; a Redis deny-list
  would close the gap if needed.
- **Refresh re-validates membership** (`resolveMembership`) so a suspended tenant or removed member
  cannot mint a new access token.
- **SSR.** `proxy.ts` (Next 16 middleware) sees a missing `dn_access` + present `dn_refresh`, calls the API
  refresh endpoint, forwards the new `Set-Cookie` headers to the browser **and** rewrites the request's
  cookie header so server components in the same render see a valid session. No login flash.
- **Passwords** use Node's built-in scrypt (N=16384, r=8, p=1) — no native build, no bcrypt dependency.
  Login verifies against a dummy hash when the email is unknown so response time does not reveal
  account existence.
- **Google OAuth** is a hand-rolled authorization-code flow with a hashed `state` nonce in a short-lived
  cookie. No passport.

## Consequences

- Zero DB reads for authorization on normal requests; one indexed lookup per refresh (every 15 minutes
  per active user).
- A user in several workspaces switches via `POST /auth/switch-tenant`, which mints a new session pinned
  to the other tenant — the tenant id is never taken from the request body on data routes.
- Tested in `backend/test/integration/auth.test.ts`: signup/login, rotation, reuse detection, logout,
  invite acceptance, RBAC on routes, session revocation on member removal.
