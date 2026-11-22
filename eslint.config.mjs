import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/build-artifacts/**',
      'apps/mobile/android/**',
      'apps/mobile/.expo/**',
      // Vendored from the Applink skill, kept byte-for-byte.
      'tools/catalog.mjs',
      'scripts/mock-applink.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node scripts (no TypeScript, no bundler): they run on Node 22+, which has these globals.
    files: ['scripts/**/*.mjs', 'apps/api/build.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
