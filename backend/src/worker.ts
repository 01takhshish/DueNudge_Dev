import { Worker, type Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { JOBS, QUEUES, closeQueues, ensureSchedulers, redisConnection } from './jobs/queues.js';
import {
  processMarkOverdue,
  processRequeueStaleEmails,
  processScanDueReminders,
  processSendEmail,
  processSendReminder,
} from './jobs/processors.js';

if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });

const connection = redisConnection();

function makeWorker(
  queue: string,
  handler: (job: Job) => Promise<unknown>,
  concurrency: number,
): Worker {
  const w = new Worker(queue, handler, { connection, concurrency, lockDuration: 60_000 });
  w.on('completed', (job) =>
    logger.debug({ queue, jobId: job.id, name: job.name }, 'job completed'),
  );
  w.on('failed', (job, err) => {
    logger.error(
      { queue, jobId: job?.id, name: job?.name, attempts: job?.attemptsMade, err },
      'job failed',
    );
    if (config.SENTRY_DSN) Sentry.captureException(err, { tags: { queue, job: job?.name } });
  });
  w.on('error', (err) => logger.error({ queue, err }, 'worker error'));
  return w;
}

const workers = [
  makeWorker(QUEUES.email, (job) => processSendEmail(job), 10),
  makeWorker(
    QUEUES.reminders,
    async (job) => {
      if (job.name === JOBS.scanDueReminders) return processScanDueReminders();
      if (job.name === JOBS.sendReminder) return processSendReminder(job);
      logger.warn({ name: job.name }, 'unknown reminders job');
    },
    5,
  ),
  makeWorker(
    QUEUES.maintenance,
    async (job) => {
      if (job.name === JOBS.markOverdue) return processMarkOverdue();
      if (job.name === JOBS.requeueStaleEmails) return processRequeueStaleEmails();
      logger.warn({ name: job.name }, 'unknown maintenance job');
    },
    1,
  ),
];

await ensureSchedulers();
logger.info({ queues: Object.values(QUEUES) }, 'worker started');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  await closePool();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
