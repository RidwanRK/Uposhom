import type { Pool } from 'pg';
import { DOMAIN_MIGRATIONS } from './migrations.generated.js';
import { DRUG_MIGRATIONS } from './migrations.js';

export interface Migration {
  id: string;
  sql: string;
}

/**
 * Boot order inside packages/db: B's domain tables (which also enable pg_trgm), then workstream C's
 * drug tables (src/migrations.ts, C's file). C's ids are prefixed so the two lists never collide.
 */
export const ALL_DB_MIGRATIONS: Migration[] = [
  ...DOMAIN_MIGRATIONS,
  ...DRUG_MIGRATIONS.map((m) => ({ id: `drug:${m.id}`, sql: m.sql })),
];

/** Not A's key (74_110_001): the two runners are called one after the other, never nested. */
const LOCK_KEY = 74_110_002;

/**
 * Applies the domain migrations in order, each in its own transaction, under an advisory lock so
 * two containers starting together cannot run them twice. Safe on every boot.
 *
 * Must run AFTER A's runMigrations (apps/api/src/db/migrate.ts): domain tables reference `users`
 * and `charges`. Never edit a migration that has shipped; change the schema and generate a new one.
 */
export async function runDomainMigrations(
  pool: Pool,
  list: Migration[] = ALL_DB_MIGRATIONS,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS domain_schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set(
      (await client.query<{ id: string }>('SELECT id FROM domain_schema_migrations')).rows.map(
        (r) => r.id,
      ),
    );
    for (const m of list) {
      if (done.has(m.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO domain_schema_migrations (id) VALUES ($1)', [m.id]);
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
