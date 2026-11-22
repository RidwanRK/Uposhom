import type { Pool } from 'pg';
import { MIGRATIONS, type Migration } from './migrations.js';

const LOCK_KEY = 74_110_001; // arbitrary, shared by every process that migrates this database

/**
 * Applies the A-owned migrations in order, each in its own transaction, under an advisory lock so
 * that two containers starting together cannot run them twice. Safe to call on every boot.
 * Returns the ids it applied.
 */
export async function runMigrations(
  pool: Pool,
  migrations: Migration[] = MIGRATIONS,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS applink_schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set(
      (await client.query<{ id: string }>('SELECT id FROM applink_schema_migrations')).rows.map(
        (r) => r.id,
      ),
    );
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO applink_schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
        applied.push(m.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return applied;
}
