// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

// Shared base ESLint config for every workspace. Each app/package has its own
// `eslint.config.mjs` that re-exports this so `turbo run lint` lints them all,
// and so ESLint's flat-config resolution finds a config next to any file.
//
// Only the framework's own TypeScript sources are linted. Scaffold templates
// (seed projects the agent edits — they carry intentional browser/node globals
// and starter patterns), generated JS, and `*.config.js` files are excluded.
export const base = defineConfig(
  {
    ignores: [
      'dist/**/*',
      '.claude/**/*',
      // Scaffold template projects — not framework source; they contain
      // intentional browser/node globals and starter code.
      '**/scaffold/**',
      '**/scaffolds/**',
      // Non-TypeScript files (generated JS, *.config.js, ESM scripts).
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
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
