import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool.js';
import { redisConnection } from '../../jobs/queues.js';

const startedAt = Date.now();

export const healthRoutes: FastifyPluginAsync = async (app) => {
  /** Liveness: the process is up. Never touches dependencies. */
  app.get('/health', { schema: { tags: ['health'] } }, async () => ({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));

  /** Readiness: can we serve traffic? Checks Postgres and Redis with short timeouts. */
  app.get('/ready', { schema: { tags: ['health'] } }, async (_req, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = { postgres: 'fail', redis: 'fail' };
    const withTimeout = <T>(p: Promise<T>, ms: number) =>
      Promise.race([
        p,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
      ]);
    try {
      await withTimeout(pool.query('SELECT 1'), 2000);
      checks.postgres = 'ok';
    } catch {
      /* reported below */
    }
    try {
      const redis = redisConnection();
      if (redis.status === 'wait') await redis.connect();
      await withTimeout(redis.ping(), 2000);
      checks.redis = 'ok';
    } catch {
      /* reported below */
    }
    const ready = Object.values(checks).every((c) => c === 'ok');
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'degraded', checks });
  });
};
