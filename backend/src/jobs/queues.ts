import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { emailJobId, reminderJobId } from './ids.js';

export const QUEUES = {
  email: 'email',
  reminders: 'reminders',
  maintenance: 'maintenance',
} as const;

export const JOBS = {
  sendEmail: 'send-email',
  scanDueReminders: 'scan-due-reminders',
  sendReminder: 'send-reminder',
  markOverdue: 'mark-overdue-invoices',
  requeueStaleEmails: 'requeue-stale-emails',
} as const;

export interface SendEmailJob {
  emailLogId: string;
  tenantId: string;
}
export interface SendReminderJob {
  reminderId: string;
  tenantId: string;
}

let connection: Redis | null = null;
export function redisConnection(): Redis {
  if (!connection) {
    connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return connection;
}

const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 }, // 5s, 10s, 20s, 40s, 80s (+ jitter by BullMQ)
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const queues = new Map<string, Queue>();
function queue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnection(), defaultJobOptions: DEFAULT_JOB_OPTS });
    queues.set(name, q);
  }
  return q;
}

export const emailQueue = () => queue(QUEUES.email);
export const reminderQueue = () => queue(QUEUES.reminders);
export const maintenanceQueue = () => queue(QUEUES.maintenance);

export async function enqueueSendEmail(data: SendEmailJob): Promise<void> {
  // jobId makes enqueue idempotent: the same email_log row can never be queued twice concurrently.
  await emailQueue().add(JOBS.sendEmail, data, { jobId: emailJobId(data.emailLogId) });
}

export async function enqueueSendReminder(data: SendReminderJob, delayMs = 0): Promise<void> {
  await reminderQueue().add(JOBS.sendReminder, data, {
    jobId: reminderJobId(data.reminderId),
    delay: delayMs,
  });
}

/** Registers the repeatable jobs (idempotent — safe to call on every worker boot). */
export async function ensureSchedulers(): Promise<void> {
  await reminderQueue().upsertJobScheduler(
    'scan-due-reminders',
    { every: 15 * 60 * 1000 },
    { name: JOBS.scanDueReminders },
  );
  await maintenanceQueue().upsertJobScheduler(
    'mark-overdue',
    { pattern: '5 0 * * *' },
    { name: JOBS.markOverdue },
  );
  await maintenanceQueue().upsertJobScheduler(
    'requeue-stale-emails',
    { every: 5 * 60 * 1000 },
    { name: JOBS.requeueStaleEmails },
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}
