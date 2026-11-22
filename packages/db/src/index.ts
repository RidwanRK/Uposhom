// @uposhom/db: Drizzle schema for the domain tables (workstream B), the domain migration runner,
// and the Drizzle client. A's Applink tables keep their own runner in apps/api/src/db/.
export * from './schema/domain.js';
export { users, charges } from './schema/platform.js';
export { createDb, schema, type Db } from './client.js';
export { runDomainMigrations, type Migration } from './migrate.js';
