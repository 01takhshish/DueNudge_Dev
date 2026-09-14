import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

// Parse BIGINT (int8) and NUMERIC as JS numbers. All our money columns are bigint cents, which
// stay far below 2^53 for any realistic invoice. Counts from count(*) are also int8.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// Keep DATE as the plain 'YYYY-MM-DD' string (no timezone drift).
pg.types.setTypeParser(1082, (v) => v);

/** Runtime pool: connects as the RLS-enforced application role. */
export const pool = new Pool({
  connectionString: config.DATABASE_APP_URL,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'duenudge-api',
});

pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));

export async function closePool(): Promise<void> {
  await pool.end();
}
