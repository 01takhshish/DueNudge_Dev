import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rolesSql = path.join(here, '..', '..', '..', 'infra', 'db', 'init', '01-roles.sql');

/** Creates the test database if needed, drops & recreates the schema, runs migrations. */
export async function resetDatabase(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.query(await readFile(rolesSql, 'utf8'));
  } finally {
    await admin.end();
  }
  const owner = new pg.Client({ connectionString: url.toString() });
  await owner.connect();
  try {
    await owner.query(
      'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;',
    );
  } finally {
    await owner.end();
  }
  await migrate(url.toString());
}

/** Owner-role client for assertions that must bypass the app role (e.g. counting rows across tenants). */
export function ownerClient(): pg.Client {
  return new pg.Client({ connectionString: process.env.DATABASE_URL });
}
