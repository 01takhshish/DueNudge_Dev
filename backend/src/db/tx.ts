import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from './pool.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * A thin transaction wrapper. Every tenant-scoped query in the codebase runs through `withTenant`,
 * which sets `app.tenant_id` for the duration of the transaction. Postgres RLS policies read that
 * setting, so a query that forgets a `WHERE tenant_id = ...` clause still cannot see other tenants.
 *
 * `SET LOCAL` is transaction-scoped: it is automatically cleared at COMMIT/ROLLBACK, so a pooled
 * connection can never leak one tenant's context to the next request.
 */
export class Tx {
  private commitHooks: Array<() => Promise<void> | void> = [];

  constructor(
    private readonly client: PoolClient,
    public readonly tenantId: string | null,
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.client.query<T>(text, params);
    return res.rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
    entity = 'Resource',
  ): Promise<T> {
    const rows = await this.query<T>(text, params);
    const row = rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND', `${entity} not found`);
    return row;
  }

  async maybeOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  async execute(text: string, params: unknown[] = []): Promise<number> {
    const res = await this.client.query(text, params);
    return res.rowCount ?? 0;
  }

  /** Runs after a successful COMMIT. Used to enqueue jobs so a rollback never leaves orphan jobs. */
  onCommit(fn: () => Promise<void> | void): void {
    this.commitHooks.push(fn);
  }

  /**
   * @internal Runs after COMMIT. A failing hook is logged, never thrown: the data change already
   * happened, so failing the request would lie to the caller. Every hook in this codebase enqueues a job
   * whose source of truth is a committed row (email_log / reminders), and a sweeper or scanner re-enqueues
   * it — so a lost enqueue costs latency, not correctness.
   */
  async runCommitHooks(): Promise<void> {
    const hooks = this.commitHooks;
    this.commitHooks = [];
    for (const hook of hooks) {
      try {
        await hook();
      } catch (err) {
        logger.error(
          { err, tenantId: this.tenantId },
          'post-commit hook failed (will be recovered by sweeper)',
        );
      }
    }
  }
}

async function run<T>(
  context: { tenantId: string | null; system: boolean },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const tx = new Tx(client, context.tenantId);
  try {
    await client.query('BEGIN');
    if (context.system) {
      await client.query(`SELECT set_config('app.role', 'system', true)`);
    }
    if (context.tenantId) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [context.tenantId]);
    }
    const result = await fn(tx);
    await client.query('COMMIT');
    await tx.runCommitHooks();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection is likely broken; release will destroy it */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Tenant-scoped transaction: RLS restricts every tenant table to `tenantId`. */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!tenantId) throw new AppError(500, 'INTERNAL', 'withTenant called without a tenant id');
  return run({ tenantId, system: false }, fn);
}

/**
 * System transaction: bypasses tenant RLS via the `system_bypass` policy.
 * Only for code paths that are inherently cross-tenant (auth, Stripe webhooks, job schedulers,
 * platform admin). Grep for `withSystem(` to audit every such path.
 */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run({ tenantId: null, system: true }, fn);
}

/** System context but *also* pinned to a tenant — used by workers that act on behalf of one tenant. */
export function withSystemTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run({ tenantId, system: true }, fn);
}
