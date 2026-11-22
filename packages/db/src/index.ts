/**
 * @uposhom/db
 *
 * Workstream B: Drizzle schema for the domain tables, the domain migration runner, the client.
 * A's Applink tables keep their own runner in apps/api/src/db/.
 * Workstream C: drug tables, medical catalog, health tips, migrations and seed loaders.
 */
export * from './schema/domain.js';
export { users, charges } from './schema/platform.js';
export { createDb, schema, type Db } from './client.js';
export { runDomainMigrations, type Migration } from './migrate.js';
export * from './schema/drugs.js';
export * from './migrations.js';
export * from './seed.js';
