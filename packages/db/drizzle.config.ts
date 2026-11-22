import { defineConfig } from 'drizzle-kit';

// Only the domain schema: A's tables (src/schema/platform.ts) are migrated by A and must never be
// generated here. Run `pnpm --filter @uposhom/db db:generate`, which also embeds the SQL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/domain.ts',
  out: './drizzle',
  strict: true,
});
