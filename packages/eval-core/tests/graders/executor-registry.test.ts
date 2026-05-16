/**
 * Tests for the grader executor registry.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from '../tmp.js';
import { contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, GraderResult } from '@a0/eval-graders';
import { setFrameworkConfig } from '../../src/config/framework-config.js';
import type { FrameworkConfig } from '../../src/config/framework.js';
import { registerExecutor, getExecutor, executeGrader } from '../../src/graders/executors/index.js';
import type { GraderContext, GraderExecutor } from '../../src/graders/executors/index.js';

// Import engine to trigger built-in executor registration.
import '../../src/graders/engine.js';

const TEST_CONFIG: Required<FrameworkConfig> = {
  evalsDir: 'src/evals',
  proxy: { baseUrl: 'https://llm.example.com/v1' },
  mcp: { servers: {} },
  skills: { remoteRepos: [], localDirs: [] },
  judge: {
    model: 'claude-opus-4-7',
    maxTokens: 1024,
    maxCodeChars: 16_384,
  },
  models: {
    known: ['gpt-5.4'],
    default: 'gpt-5.4',
    bedrock: {},
    litellm: {},
  },
};

beforeAll(() => {
  setFrameworkConfig(TEST_CONFIG);
});

const tmpDir = makeTmpDir('executor_registry_test_');

// ── getExecutor ─────────────────────────────────────────────────────────────

describe('getExecutor', () => {
  it('returns an executor for built-in kind "contains"', () => {
    const executor = getExecutor('contains');
    expect(executor).toBeDefined();
    expect(executor!.kind).toBe('contains');
  });

  it('returns an executor for built-in kind "judge"', () => {
    const executor = getExecutor('judge');
    expect(executor).toBeDefined();
    expect(executor!.kind).toBe('judge');
  });

  it('returns undefined for unknown kind', () => {
    expect(getExecutor('nonexistent_kind')).toBeUndefined();
  });
});

// ── registerExecutor ────────────────────────────────────────────────────────

describe('registerExecutor', () => {
  it('registers a custom executor and retrieves it by kind', () => {
    const custom: GraderExecutor = {
      kind: 'custom_test_kind',
      async execute(def: GraderDef, _ctx: GraderContext): Promise<GraderResult> {
        return { name: def.name, kind: def.kind, passed: true, detail: 'custom executed' };
      },
    };

    registerExecutor(custom);
    expect(getExecutor('custom_test_kind')).toBe(custom);
  });

  it('overwrites a previous registration for the same kind', () => {
    const first: GraderExecutor = {
      kind: 'overwrite_test',
      async execute(def: GraderDef): Promise<GraderResult> {
        return { name: def.name, kind: def.kind, passed: false, detail: 'first' };
      },
    };
    const second: GraderExecutor = {
      kind: 'overwrite_test',
      async execute(def: GraderDef): Promise<GraderResult> {
        return { name: def.name, kind: def.kind, passed: true, detail: 'second' };
      },
    };

    registerExecutor(first);
    registerExecutor(second);
    expect(getExecutor('overwrite_test')).toBe(second);
  });
});

// ── executeGrader ───────────────────────────────────────────────────────────

describe('executeGrader', () => {
  it('dispatches to the correct executor and returns its result', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.tsx'), "import { Auth0Provider } from '@auth0/auth0-react';");

    const grader = contains('Auth0Provider', 'has Auth0Provider', GraderLevel.L1);
    const ctx: GraderContext = {
      workspace: dir,
      files: { 'App.tsx': "import { Auth0Provider } from '@auth0/auth0-react';" },
      combinedText: "// FILE: App.tsx\nimport { Auth0Provider } from '@auth0/auth0-react';",
      combinedLower: "// file: app.tsx\nimport { auth0provider } from '@auth0/auth0-react';",
    };

    const result = await executeGrader(grader, ctx);

    expect(result.passed).toBe(true);
    expect(result.kind).toBe('contains');
    expect(result.level).toBe(GraderLevel.L1);
  });

  it('returns a failure result for unknown grader kind', async () => {
    const grader: GraderDef = { kind: 'unknown_kind', name: 'mystery grader' };
    const ctx: GraderContext = {
      workspace: '/tmp',
      files: {},
      combinedText: '',
      combinedLower: '',
    };

    const result = await executeGrader(grader, ctx);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Unknown grader kind: unknown_kind');
  });

  it('text-search executors work without judge config', async () => {
    const ctx: GraderContext = {
      workspace: '/tmp',
      files: { 'index.ts': 'const x = 1;' },
      combinedText: '// FILE: index.ts\nconst x = 1;',
      combinedLower: '// file: index.ts\nconst x = 1;',
      // No apiKey, no judge — should still work for text graders
    };

    const result = await executeGrader(contains('const x'), ctx);
    expect(result.passed).toBe(true);
  });

  it('judge executor fails gracefully without judge config', async () => {
    const grader: GraderDef = { kind: 'judge', name: 'needs judge', question: 'Is this correct?' };
    const ctx: GraderContext = {
      workspace: '/tmp',
      files: {},
      combinedText: '',
      combinedLower: '',
      // No apiKey, no judge
    };

    const result = await executeGrader(grader, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('requires apiKey and judge configuration');
  });
});
