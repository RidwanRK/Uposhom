/**
 * Migration entry point, run by the deploy script before every `up -d`:
 *   docker compose run --rm api node dist/migrate.js
 *
 * Day 0 placeholder: there are no migrations yet. B owns the Drizzle setup and migration
 * order in packages/db, and this file will call its migrator once that lands.
 */
console.log('migrate: no migrations yet (Drizzle setup lands in packages/db)');
