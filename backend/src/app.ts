import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { config } from './config.js';
import { loggerOptions } from './lib/logger.js';
import { registerValidation, toOpenApiSchema } from './plugins/validation.js';
import { authPlugin } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { tenantRoutes } from './modules/tenants/routes.js';
import { teamRoutes } from './modules/team/routes.js';
import { clientRoutes } from './modules/clients/routes.js';
import { invoiceRoutes } from './modules/invoices/routes.js';
import { reminderRoutes } from './modules/reminders/routes.js';
import { billingRoutes, stripeWebhookRoutes } from './modules/billing/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { publicRoutes } from './modules/public/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  if (config.SENTRY_DSN) {
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV, tracesSampleRate: 0.1 });
  }

  const app = Fastify({
    logger: loggerOptions,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  registerValidation(app);
  registerErrorHandler(app);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: [config.APP_URL], credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/health') || req.url.startsWith('/ready'),
    errorResponseBuilder: (req, ctx) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Retry in ${ctx.after}.`,
        requestId: req.id,
      },
    }),
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'DueNudge API',
        version: '1.0.0',
        description:
          'Multi-tenant invoicing & payment-reminder API. Auth via httpOnly cookies (or Bearer). Errors use a single envelope: { error: { code, message, requestId } }.',
      },
      servers: [{ url: config.API_PUBLIC_URL }],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'dn_access' },
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    },
    transform: ({ schema, url }) => ({ schema: toOpenApiSchema(schema ?? {}), url }),
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(stripeWebhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(publicRoutes, { prefix: '/public' });
      await v1.register(tenantRoutes, { prefix: '/tenant' });
      await v1.register(teamRoutes, { prefix: '/team' });
      await v1.register(clientRoutes, { prefix: '/clients' });
      await v1.register(invoiceRoutes, { prefix: '/invoices' });
      await v1.register(reminderRoutes, { prefix: '/invoices' });
      await v1.register(billingRoutes, { prefix: '/billing' });
      await v1.register(auditRoutes, { prefix: '/audit' });
      await v1.register(dashboardRoutes, { prefix: '/dashboard' });
      await v1.register(adminRoutes, { prefix: '/admin' });
    },
    { prefix: '/api/v1' },
  );

  if (config.SENTRY_DSN) Sentry.setupFastifyErrorHandler(app);

  return app;
}
