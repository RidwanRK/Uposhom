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
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
