import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        run: resolve(__dirname, 'run.ts'),
        report: resolve(__dirname, 'report.ts'),
        'evals/quickstarts/react/graders': resolve(__dirname, 'evals/quickstarts/react/graders.ts'),
        'evals/quickstarts/nextjs/graders': resolve(__dirname, 'evals/quickstarts/nextjs/graders.ts'),
        'evals/quickstarts/swift/graders': resolve(__dirname, 'evals/quickstarts/swift/graders.ts'),
      },
      formats: ['es'],
    },
    target: 'node24',
    outDir: 'dist',
    rollupOptions: {
      external: [
        'node:fs',
        'node:path',
        'node:os',
        'node:child_process',
        'node:url',
        'node:crypto',
        'fs',
        'path',
        'os',
        'child_process',
        'url',
        'crypto',
        'commander',
        'dotenv',
        'nunjucks',
        'p-limit',
      ],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
