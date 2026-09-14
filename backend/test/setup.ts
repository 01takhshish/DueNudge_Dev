// Test environment defaults. Real Postgres is required for integration tests; Redis is mocked.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-test-secret';
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5433/duenudge_test';
process.env.DATABASE_APP_URL ??=
  'postgres://duenudge_app:app_password@localhost:5433/duenudge_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.STRIPE_PRICE_PRO ??= 'price_test_pro';
process.env.STRIPE_PRICE_BUSINESS ??= 'price_test_business';
delete process.env.SMTP_URL;
delete process.env.RESEND_API_KEY;
