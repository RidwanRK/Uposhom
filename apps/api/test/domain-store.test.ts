import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, runDomainMigrations } from '@uposhom/db';
import { runMigrations } from '../src/db/migrate.js';
import { createMemoryDomainStore } from '../src/domain/memory.js';
import { createPostgresDomainStore } from '../src/domain/postgres.js';
import { domainContract } from './domain-contract.js';

domainContract('memory', async () => ({
  store: createMemoryDomainStore(),
  addUser: async () => undefined,
  cleanup: async () => undefined,
}));

// Same contract on a real Postgres when TEST_DATABASE_URL is set (CI has a service). Each test
// gets a schema of its own, with A's and B's migrations applied in boot order.
const url = process.env['TEST_DATABASE_URL'];
if (url) {
  domainContract('postgres', async () => {
    const schema = `t_${randomBytes(5).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: url,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    await runMigrations(pool);
    await runDomainMigrations(pool);
    return {
      store: createPostgresDomainStore(createDb(pool)),
      addUser: async (id) => {
        await pool.query(
          `INSERT INTO users (id, msisdn_hash, phone_enc, account_type) VALUES ($1, $1, 'enc', 'INDIVIDUAL')`,
          [id],
        );
      },
      cleanup: async () => {
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  });
}
