import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createPgBossQueue } from './queue/pgboss.js';

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

  const app = buildApp(config, queue ? { queue } : {});

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
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
