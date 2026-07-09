// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

// Shared base ESLint config for every workspace. Each app/package has its own
// `eslint.config.mjs` that re-exports this so `turbo run lint` lints them all,
// and so ESLint's flat-config resolution finds a config next to any file.
//
// Only TypeScript sources are linted. Scaffold templates, generated JS, and
// `*.config.js` files are intentionally excluded — they are not part of the
// framework's typechecked source.
export const base = defineConfig(
  {
    // Only TypeScript is linted; ignore build output, injected context, and
    // all non-TS files (scaffold templates, generated JS, *.config.js).
    ignores: ['dist/**/*', '.claude/**/*', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    // Console output is expected in tests and in eval graders/scaffolds.
    files: ['**/tests/**/*.ts', '**/src/evals/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);

export default base;
