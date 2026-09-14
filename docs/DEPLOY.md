# Deploying

Two shapes, pick one.

| | Frontend-only (demo mode) | Full product |
|---|---|---|
| What runs | `frontend/` on Vercel | `frontend/` on Vercel + `backend/` on Render/Fly + Postgres + Redis |
| Cost | $0 | $0 on free tiers with caveats (see below) |
| Data | In-memory sample workspace per visitor, resets on cold start | Real, persistent |
| Emails / Stripe / AI | Simulated | Real |
| Good for | Portfolio, demos, proposals | Actual customers |

---

## A. Frontend-only on Vercel (demo mode) — 5 minutes

1. **Push to GitHub.** From the repo root:
   ```bash
   git init && git add -A && git commit -m "feat: DueNudge" && gh repo create duenudge --public --source=. --push
   ```
2. **Import in Vercel** → *Add New Project* → pick the repo.
3. **Settings on the import screen:**
   - Root Directory: `frontend`
   - Framework: Next.js (auto)
   - Install / Build commands are already set in `frontend/vercel.json` (they run from the monorepo root so `packages/shared` builds first).
4. **Environment variables:**
   ```
   NEXT_PUBLIC_DEMO_MODE=true
   APP_URL=https://<your-project>.vercel.app     # set after the first deploy if you don't know the URL yet
   ```
5. **Deploy.** Open the site → *Try the live demo* → you are in the sample workspace.

Optional extras: add `NEXT_PUBLIC_POSTHOG_KEY` for analytics, a custom domain under *Settings → Domains*.

What demo mode does: `frontend/app/api/[...path]/route.ts` answers API calls from `frontend/lib/demo/` instead of proxying to a
backend; server components call the same mock in-process. The sample workspace lives in `lib/demo/store.ts` — edit it to
change the data people see. Each visitor gets their own copy (keyed by the `dn_demo` cookie), so one person's clicks never
show up for another.

---

## B. Full product

### Backend (`backend/`) on Render — free tier

1. **Postgres**: create a free project on [Neon](https://neon.tech). In its SQL editor run `infra/db/init/01-roles.sql`
   (creates the `duenudge_app` role — change the password!). Note two connection strings: the owner one → `DATABASE_URL`,
   the same host with user `duenudge_app` → `DATABASE_APP_URL`.
2. **Redis**: Render → *New → Key Value* (free 25 MB). Copy the internal URL → `REDIS_URL`.
3. **API**: Render → *New → Web Service* → your repo. Runtime **Docker**, Dockerfile path `backend/Dockerfile`, docker
   context `.` (repo root). Instance type Free. Env vars: everything in `.env.example` under Core, Database, Redis, Auth,
   Stripe, Email, plus:
   ```
   NODE_ENV=production
   COOKIE_SECURE=true
   APP_URL=https://<your-vercel-app>.vercel.app
   API_PUBLIC_URL=https://<this-service>.onrender.com
   RUN_WORKER_INLINE=true        # free tier has no background workers: run them inside the API process
   ```
   Pre-deploy command: `node dist/db/migrate.js`.
4. **Keep it awake.** Free web services sleep after 15 min idle and a sleeping worker sends no reminders. Add a monitor at
   [cron-job.org](https://cron-job.org) (free) hitting `https://<service>.onrender.com/health` every 10 minutes.
5. **Stripe**: Dashboard → Developers → Webhooks → endpoint `https://<service>.onrender.com/api/v1/webhooks/stripe`,
   events `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`. Copy the signing secret.
   Create two recurring prices (Pro $19, Business $49) → `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS`.
6. **Email**: [Resend](https://resend.com) free tier → `RESEND_API_KEY`, verify a sending domain, set `EMAIL_FROM`.
7. **Google sign-in** (optional): OAuth client in Google Cloud Console with redirect URI
   `https://<your-vercel-app>.vercel.app/api/v1/auth/google/callback` (through the web domain, so cookies land there).

### Frontend (`frontend/`) on Vercel

Same as section A, but:
```
NEXT_PUBLIC_DEMO_MODE=false
API_URL=https://<service>.onrender.com
APP_URL=https://<your-project>.vercel.app
GOOGLE_CLIENT_ID=...            # only to show the button
```

### Free-tier caveats, honestly
- Render free: 750 hours/month = exactly one always-on service. Cold start ~30–60 s if the pinger misses.
- Neon free: compute pauses after inactivity; first query wakes it (~1 s).
- Resend free: 100 emails/day, 3,000/month.
- AI drafting is pay-per-call on the Anthropic API — leave `ANTHROPIC_API_KEY` unset to disable it, or fund a small balance.

### Paid, boring, recommended once real money flows
Fly.io (`infra/fly.api.toml`: separate `api` and `worker` processes, release-command migrations), Neon Launch or Fly Postgres,
Upstash/Redis Cloud, a custom domain. Roughly $15–25/month.
