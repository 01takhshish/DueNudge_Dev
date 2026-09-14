import pino from 'pino';
import { config } from '../config.js';

/**
 * Structured JSON logs in production; pretty in development.
 * Every request log carries `reqId`; workers attach `jobId`/`tenantId`.
 */
export const loggerOptions: pino.LoggerOptions = {
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.apiKey'],
    censor: '[redacted]',
  },
  ...(config.isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }),
};

export const logger = pino(loggerOptions);

export type Logger = typeof logger;
