import { defineConfig, configDefaults } from 'vitest/config';

// Live OpenRouter integration tests are excluded by default to avoid consuming API limits/quota.
// They are ONLY executed when explicitly requested via `pnpm test:live` (setting RUN_LIVE_TESTS=1).
const isLiveExplicit = Boolean(process.env.RUN_LIVE_TESTS === '1' || process.env.TEST_LIVE === '1');

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: isLiveExplicit
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'test/**/live-*.test.ts', 'test/**/*live*.test.ts'],
  },
});
