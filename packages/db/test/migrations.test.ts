import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOMAIN_MIGRATIONS } from '../src/migrations.generated.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const journal = JSON.parse(readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string }>;
};

describe('embedded migrations', () => {
  it('match drizzle/ exactly (run `pnpm --filter @uposhom/db db:generate` if this fails)', () => {
    const expected = journal.entries
      .sort((a, b) => a.idx - b.idx)
      .map((e) => ({
        id: e.tag,
        sql: readFileSync(join(root, 'drizzle', `${e.tag}.sql`), 'utf8').replaceAll(
          '"public".',
          '',
        ),
      }));
    expect(DOMAIN_MIGRATIONS).toEqual(expected);
  });

  it('never create or alter workstream A tables', () => {
    for (const m of DOMAIN_MIGRATIONS) {
      for (const table of ['users', 'charges', 'consents', 'sessions', 'sms_log']) {
        expect(m.sql).not.toMatch(new RegExp(`(CREATE|ALTER|DROP) TABLE "${table}"`));
      }
    }
  });

  it('start with pg_trgm', () => {
    expect(DOMAIN_MIGRATIONS[0]!.sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  });

  it('follow search_path (no schema-qualified names)', () => {
    for (const m of DOMAIN_MIGRATIONS) expect(m.sql).not.toContain('"public".');
  });
});
