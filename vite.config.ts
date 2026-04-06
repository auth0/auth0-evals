import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        run: resolve(__dirname, 'src/run.ts'),
        report: resolve(__dirname, 'src/report.ts'),
        'src/evals/quickstarts/react/graders': resolve(__dirname, 'src/evals/quickstarts/react/graders.ts'),
        'src/evals/quickstarts/nextjs/graders': resolve(__dirname, 'src/evals/quickstarts/nextjs/graders.ts'),
        'src/evals/quickstarts/swift/graders': resolve(__dirname, 'src/evals/quickstarts/swift/graders.ts'),
        'src/evals/quickstarts/android/graders': resolve(__dirname, 'src/evals/quickstarts/android/graders.ts'),
        'src/evals/quickstarts/express/graders': resolve(__dirname, 'src/evals/quickstarts/express/graders.ts'),
        'src/evals/quickstarts/express-api/graders': resolve(__dirname, 'src/evals/quickstarts/express-api/graders.ts'),
        'src/evals/quickstarts/fastapi/graders': resolve(__dirname, 'src/evals/quickstarts/fastapi/graders.ts'),
        'src/evals/quickstarts/fastify-api/graders': resolve(__dirname, 'src/evals/quickstarts/fastify-api/graders.ts'),
        'src/evals/quickstarts/vue/graders': resolve(__dirname, 'src/evals/quickstarts/vue/graders.ts'),
        'src/evals/quickstarts/nuxt/graders': resolve(__dirname, 'src/evals/quickstarts/nuxt/graders.ts'),
        'src/evals/quickstarts/angular/graders': resolve(__dirname, 'src/evals/quickstarts/angular/graders.ts'),
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
        /^@modelcontextprotocol\//,
        'braintrust',
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
