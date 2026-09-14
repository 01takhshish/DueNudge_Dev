/**
 * THE tenant-isolation test. Proves, at the database level and at the API level, that tenant A
 * cannot read, update, or insert into tenant B's data — even with a query that omits the tenant filter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDatabase } from '../helpers/db.js';
import { createClient, createInvoice, makeApp, signup, type Session } from '../helpers/app.js';
import { withSystem, withTenant } from '../../src/db/tx.js';
import { closePool, pool } from '../../src/db/pool.js';

let app: FastifyInstance;
let a: Session;
let b: Session;
let invoiceB: string;
let clientB: string;

beforeAll(async () => {
  await resetDatabase();
  app = await makeApp();
  a = await signup(app, 'a@tenant-a.test', { tenantName: 'Tenant A' });
  b = await signup(app, 'b@tenant-b.test', { tenantName: 'Tenant B' });
  clientB = (await createClient(app, b)).json().id;
  invoiceB = (await createInvoice(app, b, clientB)).json().id;
});
afterAll(async () => {
  await app.close();
  await closePool();
});

describe('row-level security', () => {
  it("a tenant-scoped transaction cannot see another tenant's rows even without a WHERE clause", async () => {
    const rowsForA = await withTenant(a.tenantId, (tx) => tx.query('SELECT id FROM invoices'));
    expect(rowsForA).toHaveLength(0);
    const rowsForB = await withTenant(b.tenantId, (tx) => tx.query('SELECT id FROM invoices'));
    expect(rowsForB.map((r) => r.id)).toEqual([invoiceB]);
  });

  it('cannot UPDATE or DELETE across tenants (0 rows affected, no error)', async () => {
    const updated = await withTenant(a.tenantId, (tx) =>
      tx.execute(`UPDATE invoices SET notes = 'pwned' WHERE id = $1`, [invoiceB]),
    );
    expect(updated).toBe(0);
    const deleted = await withTenant(a.tenantId, (tx) =>
      tx.execute(`DELETE FROM clients WHERE id = $1`, [clientB]),
    );
    expect(deleted).toBe(0);
    const still = await withSystem((tx) =>
      tx.one<{ notes: string | null }>(`SELECT notes FROM invoices WHERE id = $1`, [invoiceB]),
    );
    expect(still.notes).toBeNull();
  });

  it("cannot INSERT a row tagged with another tenant's id (WITH CHECK)", async () => {
    await expect(
      withTenant(a.tenantId, (tx) =>
        tx.execute(
          `INSERT INTO clients (tenant_id, name, email) VALUES ($1, 'Evil', 'evil@x.test')`,
          [b.tenantId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a connection with NO tenant context sees nothing', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT count(*)::int AS n FROM invoices');
      expect(res.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('the application role cannot bypass RLS (NOBYPASSRLS, not table owner)', async () => {
    const res = await pool.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    expect(res.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    const owner = await pool.query(`SELECT tableowner FROM pg_tables WHERE tablename = 'invoices'`);
    expect(owner.rows[0].tableowner).not.toBe('duenudge_app');
  });

  it('every tenant-scoped table has RLS forced with both policies', async () => {
    const res = await withSystem((tx) =>
      tx.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policies: number;
      }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('memberships','subscriptions','refresh_tokens')`,
      ),
    );
    expect(res.length).toBeGreaterThanOrEqual(11);
    for (const r of res)
      expect(r, r.relname).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 2,
      });
  });

  it("API: tenant A gets 404 for tenant B's invoice and client, and cannot act on them", async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/invoices/${invoiceB}`,
          headers: { cookie: a.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/clients/${clientB}`,
          headers: { cookie: a.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/invoices/${invoiceB}/send`,
          headers: { cookie: a.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/invoices/${invoiceB}/void`,
          headers: { cookie: a.cookie },
        })
      ).statusCode,
    ).toBe(404);
    // Creating an invoice for B's client from A's session is a 404 on the client lookup, never a cross-tenant write.
    expect((await createInvoice(app, a, clientB)).statusCode).toBe(404);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/invoices',
      headers: { cookie: a.cookie },
    });
    expect(list.json().total).toBe(0);
  });
});
