/**
 * Migration entry point, run by the deploy script before every `up -d`:
 *   docker compose run --rm api node dist/migrate.js
 *
 * Applies the A-owned Applink and billing tables (src/db/migrations.ts). Idempotent, so it is safe
 * on every deploy, and harmless while STORE_DRIVER is still `memory`: the tables just wait.
 * Then B's domain tables (packages/db), which reference users and charges, so they always run second.
 */
import { runDomainMigrations } from '@uposhom/db';
import { runMigrations } from './db/migrate.js';
import { createPool } from './db/pool.js';

const url = process.env['DATABASE_URL']?.trim();
if (!url) {
  console.log('migrate: DATABASE_URL is not set, nothing to do');
} else {
  const pool = createPool(url, 1);
  try {
    const applied = [...(await runMigrations(pool)), ...(await runDomainMigrations(pool))];
    console.log(
      applied.length ? `migrate: applied ${applied.join(', ')}` : 'migrate: schema is up to date',
    );
  } finally {
    await pool.end();
  }
}
