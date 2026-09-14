/**
 * Minimal forward-only SQL migration runner. Runs as the OWNER role (DATABASE_URL), never the app role.
 * Each file in ./migrations is applied once, in lexical order, inside a transaction.
 */
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/ (tsx) and from dist/ (compiled) — migrations are copied alongside in the Docker image.
const candidates = [
  path.join(here, 'migrations'),
  path.join(here, '..', '..', 'src', 'db', 'migrations'),
];

export async function migrate(databaseUrl = process.env.DATABASE_URL): Promise<string[]> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('SELECT pg_advisory_lock(727272)');
    let dir = candidates[0]!;
    for (const c of candidates) {
      try {
        await readdir(c);
        dir = c;
        break;
      } catch {
        /* try next */
      }
    }
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(727272)');
  } finally {
    await client.end();
  }
  return applied;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
