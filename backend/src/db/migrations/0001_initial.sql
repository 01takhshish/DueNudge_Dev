-- ============================================================================
-- DueNudge initial schema.
-- Design notes:
--   * Global tables (users, tenants, memberships, subscriptions, stripe_events, refresh_tokens)
--     have NO row-level security: they are only touched by auth / billing / admin code paths.
--   * Every tenant-owned table carries tenant_id and has RLS + FORCE RLS with two policies:
--       tenant_isolation  -> tenant_id = current_tenant_id()   (normal requests)
--       system_bypass     -> is_system_context()               (workers, webhooks, admin)
--   * The application role (duenudge_app) is NOT the owner and has NOBYPASSRLS.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION is_system_context() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.role', true), '') = 'system'
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

-- ─── Global: identity ────────────────────────────────────────────────────────
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  name              text NOT NULL,
  password_hash     text,
  email_verified_at timestamptz,
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE oauth_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  provider_user_id text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE tenants (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  slug                       text NOT NULL UNIQUE,
  currency                   char(3) NOT NULL DEFAULT 'USD',
  timezone                   text NOT NULL DEFAULT 'UTC',
  business_email             citext,
  business_address           text,
  logo_url                   text,
  reminder_offsets           int[] NOT NULL DEFAULT '{-3,0,3,7,14}',
  default_payment_terms_days int NOT NULL DEFAULT 14,
  stripe_customer_id         text UNIQUE,
  onboarded_at               timestamptz,
  suspended_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,                -- rotation family: reuse of a rotated token revokes the family
  token_hash  text NOT NULL UNIQUE,
  tenant_id   uuid REFERENCES tenants(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid,
  user_agent  text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ─── Global: billing ─────────────────────────────────────────────────────────
CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan                   text NOT NULL CHECK (plan IN ('free', 'pro', 'business')),
  status                 text NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','incomplete','unpaid')),
  stripe_subscription_id text UNIQUE,
  stripe_price_id        text,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  trial_ends_at          timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  last_event_at          timestamptz,        -- Stripe event.created of the last applied event (ordering guard)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Idempotency ledger for Stripe webhooks. Stripe delivers at-least-once; the PK makes replays no-ops.
CREATE TABLE stripe_events (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  event_created timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL
);
CREATE INDEX stripe_events_type_idx ON stripe_events (type, event_created DESC);

-- ─── Tenant-scoped ───────────────────────────────────────────────────────────
CREATE TABLE clients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               text NOT NULL,
  email              citext NOT NULL,
  company            text,
  phone              text,
  address            text,
  notes              text,
  payment_terms_days int NOT NULL DEFAULT 14,
  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX clients_tenant_name_idx ON clients (tenant_id, lower(name));
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_counters (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_number int NOT NULL DEFAULT 1
);

CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  number            text NOT NULL,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','overdue','paid','void')),
  currency          char(3) NOT NULL,
  issue_date        date NOT NULL,
  due_date          date NOT NULL,
  subtotal_cents    bigint NOT NULL DEFAULT 0,
  tax_rate_bps      int NOT NULL DEFAULT 0,
  tax_cents         bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  amount_paid_cents bigint NOT NULL DEFAULT 0,
  notes             text,
  payment_link      text,
  public_token      text UNIQUE,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  paid_at           timestamptz,
  voided_at         timestamptz,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number),
  CHECK (due_date >= issue_date),
  CHECK (amount_paid_cents >= 0)
);
-- Access patterns: list by tenant+status (dashboard), by client (client page), due-date scans (overdue job).
CREATE INDEX invoices_tenant_status_idx ON invoices (tenant_id, status, due_date);
CREATE INDEX invoices_client_idx ON invoices (client_id);
CREATE INDEX invoices_due_open_idx ON invoices (due_date) WHERE status IN ('sent', 'viewed');
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description  text NOT NULL,
  quantity     numeric(12,2) NOT NULL,
  unit_cents   bigint NOT NULL,
  amount_cents bigint NOT NULL,
  position     int NOT NULL DEFAULT 0
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items (invoice_id, position);

CREATE TABLE invoice_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_at      date NOT NULL,
  method       text NOT NULL,
  note         text,
  recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_payments_invoice_idx ON invoice_payments (invoice_id);

CREATE TABLE reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id    uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('before_due','on_due','overdue','manual')),
  offset_days   int,
  scheduled_for timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','skipped','failed')),
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  subject       text,
  body          text,
  sent_at       timestamptz,
  email_log_id  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- One automatic reminder per (invoice, offset). Manual reminders have NULL offset and are exempt.
CREATE UNIQUE INDEX reminders_invoice_offset_uq ON reminders (invoice_id, offset_days) WHERE offset_days IS NOT NULL;
-- The scheduler's hot path: pending reminders that are due.
CREATE INDEX reminders_due_idx ON reminders (scheduled_for) WHERE status = 'pending';
CREATE INDEX reminders_invoice_idx ON reminders (invoice_id);
CREATE TRIGGER reminders_updated_at BEFORE UPDATE ON reminders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE email_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_email            citext NOT NULL,
  subject             text NOT NULL,
  template            text NOT NULL,
  html                text NOT NULL,
  text                text NOT NULL,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  provider            text,
  provider_message_id text,
  attempts            int NOT NULL DEFAULT 0,
  error               text,
  invoice_id          uuid REFERENCES invoices(id) ON DELETE SET NULL,
  reminder_id         uuid REFERENCES reminders(id) ON DELETE SET NULL,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_tenant_idx ON email_log (tenant_id, created_at DESC);
CREATE INDEX email_log_queued_idx ON email_log (created_at) WHERE status = 'queued';

CREATE TABLE ai_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id    uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tone          text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  model         text NOT NULL,
  input_tokens  int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cost_micros   bigint NOT NULL DEFAULT 0,   -- USD micro-dollars, for per-tenant cost accounting
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_drafts_invoice_idx ON ai_drafts (invoice_id, created_at DESC);

CREATE TABLE usage_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period    text NOT NULL,              -- 'YYYY-MM'
  metric    text NOT NULL,
  count     int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, period, metric)
);

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_tenant_idx ON invites (tenant_id) WHERE accepted_at IS NULL;

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, created_at DESC);

-- ─── Row-level security ──────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','invoice_counters','invoices','invoice_items','invoice_payments',
    'reminders','email_log','ai_drafts','usage_counters','invites','audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY system_bypass ON %I USING (is_system_context()) WITH CHECK (is_system_context())', t);
  END LOOP;
END
$$;

-- ─── Grants for the application role (created by infra/db/init/01-roles.sql) ──
GRANT USAGE ON SCHEMA public TO duenudge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO duenudge_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO duenudge_app;
REVOKE ALL ON schema_migrations FROM duenudge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO duenudge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO duenudge_app;
