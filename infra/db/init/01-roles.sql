-- Runs once on first Postgres boot (docker-entrypoint-initdb.d) and in CI.
-- The application NEVER connects as the table owner. It connects as duenudge_app,
-- which has NOBYPASSRLS so every row-level-security policy is enforced.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'duenudge_app') THEN
    CREATE ROLE duenudge_app LOGIN PASSWORD 'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
