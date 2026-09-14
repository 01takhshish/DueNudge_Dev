import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@duenudge/shared';
import { AppError, PlanLimitError } from '../lib/errors.js';
import { config } from '../config.js';

/**
 * Single error envelope for the whole API:
 *   { error: { code, message, requestId, details?, limit? } }
 * Unknown errors never leak internals in production.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    const requestId = req.id;
    const body: ApiErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId },
    };

    if (err instanceof PlanLimitError) {
      body.error = {
        code: err.code,
        message: err.message,
        requestId,
        limit: { metric: err.metric, limit: err.limit, current: err.current, plan: err.plan },
      };
      return reply.status(err.status).send(body);
    }

    if (err instanceof AppError) {
      body.error = {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details !== undefined ? { details: err.details } : {}),
      };
      return reply.status(err.status).send(body);
    }

    const validation = (err as FastifyError).validation as unknown;
    if (validation instanceof ZodError || err instanceof ZodError) {
      const zerr = validation instanceof ZodError ? validation : (err as ZodError);
      body.error = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId,
        details: zerr.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
      return reply.status(400).send(body);
    }

    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) {
      body.error = { code: fe.code ?? 'REQUEST_ERROR', message: fe.message, requestId };
      return reply.status(fe.statusCode).send(body);
    }

    req.log.error({ err, requestId }, 'unhandled error');
    if (!config.isProd) body.error.message = err.message;
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.url} not found`,
        requestId: req.id,
      },
    });
  });
}
