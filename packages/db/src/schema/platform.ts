import { pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Workstream A's tables, declared only so domain tables can reference them with typed foreign keys.
 * A creates and migrates them (apps/api/src/db/migrations.ts). This file is deliberately NOT in
 * drizzle.config.ts, so drizzle-kit never generates or alters them. Add columns here only when a
 * domain query needs to read them.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  subscriberId: text('subscriber_id'),
});

export const charges = pgTable('charges', {
  externalTrxId: text('external_trx_id').primaryKey(),
  userId: text('user_id').notNull(),
});
