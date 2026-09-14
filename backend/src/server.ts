import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { closeQueues } from './jobs/queues.js';
import { logger } from './lib/logger.js';

const app = await buildApp();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  try {
    await app.close();
    await closeQueues();
    await closePool();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
  logger.info({ port: config.API_PORT, docs: `${config.API_PUBLIC_URL}/docs` }, 'api listening');
} catch (err) {
  logger.error({ err }, 'failed to start');
  process.exit(1);
}
