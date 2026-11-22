import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { billingFromEnv } from './billing/config.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createPgBossQueue } from './queue/pgboss.js';
import { createPhoneCrypto } from './security/phone-crypto.js';
import { createPostgresStores } from './stores/postgres.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  // pg-boss runs on the same Postgres as everything else. Anything else uses the in-memory queue.
  const queue =
    config.QUEUE_DRIVER === 'pgboss' && config.DATABASE_URL
      ? createPgBossQueue({
          connectionString: config.DATABASE_URL,
          onError: (err) =>
            console.error(JSON.stringify({ level: 'error', msg: 'pg-boss error', err: err.name })),
        })
      : undefined;

  // Postgres stores: migrate first (idempotent, under an advisory lock), then serve.
  const pool =
    config.STORE_DRIVER === 'postgres' && config.DATABASE_URL
      ? createPool(config.DATABASE_URL)
      : undefined;
  if (pool && config.PHONE_ENC_KEY) {
    const applied = await runMigrations(pool);
    console.log(JSON.stringify({ level: 'info', msg: 'migrations checked', applied }));
  }
  const stores =
    pool && config.PHONE_ENC_KEY
      ? createPostgresStores(pool, createPhoneCrypto(config.PHONE_ENC_KEY))
      : undefined;

  const app = buildApp(config, {
    billing: billingFromEnv(config),
    ...(queue ? { queue } : {}),
    ...(stores ? { stores } : {}),
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await pool?.end();
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
