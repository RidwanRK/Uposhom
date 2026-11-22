import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { MIGRATIONS } from '../src/db/migrations.js';
import { createPhoneCrypto } from '../src/security/phone-crypto.js';
import { createMemoryStores } from '../src/stores/memory.js';
import { createPostgresStores } from '../src/stores/postgres.js';
import { storesContract } from './stores-contract.js';

storesContract('memory', async () => ({
  stores: createMemoryStores(),
  cleanup: async () => undefined,
}));

/**
 * Postgres stores run against a real database when TEST_DATABASE_URL is set (CI has a service;
 * locally: docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=uposhom_test postgres:16-alpine).
 * Each test gets a schema of its own, so runs cannot see each other's rows.
 */
const url = process.env['TEST_DATABASE_URL'];
const KEY = randomBytes(32).toString('hex');

describe.skipIf(!url)('postgres', () => {
  storesContract('postgres', async () => {
    const schema = `t_${randomBytes(5).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: url,
      max: 10,
      options: `-c search_path=${schema}`,
    });
    await runMigrations(pool);
    return {
      stores: createPostgresStores(pool, createPhoneCrypto(KEY)),
      cleanup: async () => {
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  });

  it('migrations are idempotent and apply in order', async () => {
    const schema = `t_${randomBytes(5).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: url,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    try {
      expect(await runMigrations(pool)).toEqual(MIGRATIONS.map((m) => m.id));
      expect(await runMigrations(pool)).toEqual([]);
      // Two containers booting at once must not apply anything twice.
      const other = new pg.Pool({
        connectionString: url,
        max: 2,
        options: `-c search_path=${schema}`,
      });
      const both = await Promise.all([runMigrations(pool), runMigrations(other)]);
      expect(both.flat()).toEqual([]);
      await other.end();
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('never stores a phone number in the clear', async () => {
    const schema = `t_${randomBytes(5).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: url,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    try {
      await runMigrations(pool);
      const stores = createPostgresStores(pool, createPhoneCrypto(KEY));
      await stores.users.upsertVerified({
        msisdn: '8801959979376',
        accountType: 'INDIVIDUAL',
        subscriberId: 'tel:x',
        subscriptionStatus: null,
      });
      await stores.otpSessions.create({
        msisdn: '8801959979376',
        purpose: 'SIGNUP',
        referenceNo: 'r',
        expiresAt: new Date(Date.now() + 1000),
      });
      const dump = JSON.stringify([
        (await pool.query('SELECT * FROM users')).rows,
        (await pool.query('SELECT * FROM otp_sessions')).rows,
      ]);
      expect(dump).not.toContain('8801959979376');
      expect(dump).not.toContain('1959979376');
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});

describe('phone crypto', () => {
  const c = createPhoneCrypto(KEY);

  it('round-trips, uses a fresh IV each time, and hashes deterministically', () => {
    const a = c.encrypt('8801959979376');
    const b = c.encrypt('8801959979376');
    expect(a).not.toBe(b);
    expect(c.decrypt(a)).toBe('8801959979376');
    expect(c.decrypt(b)).toBe('8801959979376');
    expect(c.lookupHash('8801959979376')).toBe(c.lookupHash('8801959979376'));
    expect(c.lookupHash('8801959979376')).not.toBe(c.lookupHash('8801959979377'));
  });

  it('rejects tampering and the wrong key', () => {
    const enc = c.encrypt('8801959979376');
    const [iv, tag, ct] = enc.split('.');
    expect(() => c.decrypt(`${iv}.${tag}.${ct?.slice(0, -2)}AA`)).toThrow();
    const other = createPhoneCrypto(randomBytes(32).toString('hex'));
    expect(() => other.decrypt(enc)).toThrow();
    expect(other.lookupHash('8801959979376')).not.toBe(c.lookupHash('8801959979376'));
  });

  it('refuses a malformed key', () => {
    expect(() => createPhoneCrypto('short')).toThrow(/64 hex/);
  });
});
