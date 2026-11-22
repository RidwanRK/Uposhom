import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as domain from './schema/domain.js';
import * as platform from './schema/platform.js';

export const schema = { ...domain, ...platform };
export type Db = NodePgDatabase<typeof schema>;

/** A Drizzle client over the API's existing pool (apps/api/src/db/pool.ts). */
export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
