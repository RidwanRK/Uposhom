import pg from 'pg';

/**
 * One small pool per process. The VM has 1 GB of RAM and Postgres runs with max_connections=30,
 * shared by the API, the worker and pg-boss, so each process keeps its pool modest.
 */
export function createPool(connectionString: string, max = 5): pg.Pool {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
}
