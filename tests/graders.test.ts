/**
 * Happy path tests for src/agent_eval/graders.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  passRate,
  runGraders,
  llmJudge,
  GraderLevel,
  type GraderResult,
} from '../src/agent_eval/graders.js';
import { JUDGE_MAX_TOKENS } from '../src/config/settings.js';

const tmpDir = makeTmpDir('graders_test_');

// ── runGraders — contains ────────────────────────────────────────────────────

describe('runGraders - contains', () => {
  it('passes when needle is present', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import { Auth0Provider } from '@auth0/auth0-react';");
    const graders = [contains('Auth0Provider', 'imports Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results.length).toBe(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].kind).toBe('contains');
    expect(results[0].name).toBe('imports Auth0Provider');
  });

  it('fails when needle is absent', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import React from 'react';");
    const graders = [contains('Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });

  it('is case insensitive', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.js'), 'auth0provider is used here');
    const graders = [contains('Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(true);
  });

  it('ignores .git directory', async () => {
    const dir = tmpDir();
    const gitDir = join(dir, '.git');
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, 'COMMIT_EDITMSG'), 'Auth0Provider is mentioned here');
    writeFileSync(join(dir, 'App.js'), "import React from 'react';");
    const graders = [contains('Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });

  it('ignores __pycache__ directory', async () => {
    const dir = tmpDir();
    const cacheDir = join(dir, '__pycache__');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'app.pyc'), 'Auth0Provider cached bytecode');
    writeFileSync(join(dir, 'app.py'), 'import react');
    const graders = [contains('Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });

  it('ignores node_modules directory', async () => {
    const dir = tmpDir();
    const nmDir = join(dir, 'node_modules', '@auth0', 'auth0-react');
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(join(nmDir, 'index.js'), "export { Auth0Provider } from './Auth0Provider';");
    writeFileSync(join(dir, 'App.js'), "import React from 'react';");
    const graders = [contains('Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });
});

// ── runGraders — notContains ────────────────────────────────────────────────

describe('runGraders - notContains', () => {
  it('passes when needle is absent', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import React from 'react';");
    const graders = [notContains('Auth0Provider', 'no Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results.length).toBe(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].kind).toBe('not_contains');
    expect(results[0].name).toBe('no Auth0Provider');
  });

  it('fails when needle is present', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import { Auth0Provider } from '@auth0/auth0-react';");
    const graders = [notContains('Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });

  it('is case insensitive', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.js'), 'auth0provider is used here');
    const graders = [notContains('Auth0Provider')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });
});

// ── runGraders — notContainsInSource ─────────────────────────────────────────

describe('runGraders - notContainsInSource', () => {
  it('passes when secret is only in a .env file', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, '.env'), 'AUTH0_SECRET=supersecret');
    writeFileSync(join(dir, 'index.ts'), "export const hello = 'world';");
    const graders = [notContainsInSource('supersecret', 'no hardcoded secret')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(true);
    expect(results[0].kind).toBe('not_contains_in_source');
    expect(results[0].name).toBe('no hardcoded secret');
  });

  it('passes when secret is only in a .env.local file', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, '.env.local'), 'AUTH0_SECRET=supersecret');
    writeFileSync(join(dir, 'index.ts'), "export const hello = 'world';");
    const graders = [notContainsInSource('supersecret')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(true);
  });

  it('fails when secret is hardcoded in a .ts source file', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'auth.ts'), "const secret = 'supersecret';");
    const graders = [notContainsInSource('supersecret')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });

  it('passes when secret is only in a .json config file', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ auth0Secret: 'supersecret' }));
    writeFileSync(join(dir, 'index.ts'), "export const hello = 'world';");
    const graders = [notContainsInSource('supersecret')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(true);
    expect(results[0].kind).toBe('not_contains_in_source');
  });

  it('passes when secret is only in a .plist config file', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'Auth0.plist'), '<string>supersecret</string>');
    writeFileSync(join(dir, 'App.swift'), 'let greeting = "hello"');
    const graders = [notContainsInSource('supersecret')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(true);
  });

  it('fails when secret is hardcoded in a .js source file', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'auth.js'), "const secret = 'supersecret';");
    const graders = [notContainsInSource('supersecret')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });
});

// ── runGraders — matches ─────────────────────────────────────────────────────

describe('runGraders - matches', () => {
  it('passes when pattern is present', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), 'const { loginWithRedirect } = useAuth0();');
    const graders = [matches(String.raw`useAuth0\(\)`, 'calls useAuth0 hook')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(true);
    expect(results[0].kind).toBe('matches');
    expect(results[0].name).toBe('calls useAuth0 hook');
  });

  it('fails when pattern is absent', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import React from 'react';");
    const graders = [matches(String.raw`useAuth0\(\)`)];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });

  it('fails gracefully for invalid regex', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), 'some code');
    const graders = [matches('[invalid')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(false);
    expect(results[0].kind).toBe('matches');
  });
});

// ── runGraders — edge cases ───────────────────────────────────────────────────

describe('runGraders - edge cases', () => {
  it('unknown kind fails gracefully', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), 'some code');
    const graders = [{ kind: 'unknown', name: 'test grader' }];

    const results = await runGraders(graders as never, dir, 'unused');

    expect(results[0].passed).toBe(false);
  });

  it('multiple graders all pass', async () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, 'App.js'),
      "import { Auth0Provider } from '@auth0/auth0-react';\nconst { loginWithRedirect } = useAuth0();",
    );
    const graders = [contains('Auth0Provider'), matches(String.raw`useAuth0\(\)`)];

    const results = await runGraders(graders, dir, 'unused');

    expect(results.length).toBe(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('multiple graders mixed results', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import { Auth0Provider } from '@auth0/auth0-react';");
    const graders = [contains('Auth0Provider'), contains('useAuth0')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });
});

// ── passRate tests ─────────────────────────────────────────────────────────────

describe('passRate', () => {
  it('all passing returns 1.0', () => {
    const results: GraderResult[] = [
      { name: 'a', kind: 'contains', passed: true, detail: '' },
      { name: 'b', kind: 'contains', passed: true, detail: '' },
    ];
    expect(passRate(results)).toBe(1.0);
  });

  it('none passing returns 0.0', () => {
    const results: GraderResult[] = [
      { name: 'a', kind: 'contains', passed: false, detail: '' },
      { name: 'b', kind: 'contains', passed: false, detail: '' },
    ];
    expect(passRate(results)).toBe(0.0);
  });

  it('half passing returns 0.5', () => {
    const results: GraderResult[] = [
      { name: 'a', kind: 'contains', passed: true, detail: '' },
      { name: 'b', kind: 'contains', passed: false, detail: '' },
    ];
    expect(passRate(results)).toBe(0.5);
  });

  it('empty list returns 1.0', () => {
    expect(passRate([])).toBe(1.0);
  });
});

// ── llmJudge reasoning tests ──────────────────────────────────────────────────

function mockFetchResponse(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response);
}

describe('llmJudge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes when first line is yes', async () => {
    vi.stubGlobal('fetch', mockFetchResponse('yes\n\nThe code correctly wraps the app with Auth0Provider.'));
    const { passed } = await llmJudge('Does it use Auth0Provider?', 'code', 'key', 'model');
    expect(passed).toBe(true);
  });

  it('fails when first line is no', async () => {
    vi.stubGlobal('fetch', mockFetchResponse('no\n\nAuth0Provider is missing from the component tree.'));
    const { passed } = await llmJudge('Does it use Auth0Provider?', 'code', 'key', 'model');
    expect(passed).toBe(false);
  });

  it('detail contains full reasoning', async () => {
    const reasoning = 'yes\n\nThe loginWithRedirect call is present on the button.';
    vi.stubGlobal('fetch', mockFetchResponse(reasoning));
    const { detail } = await llmJudge('Does it call loginWithRedirect?', 'code', 'key', 'model');
    expect(detail).toContain('loginWithRedirect call is present');
  });

  it('request sends max_tokens equal to JUDGE_MAX_TOKENS', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'yes' } }] }) };
      }),
    );
    await llmJudge('question', 'code', 'key', 'model');
    expect(capturedBody?.max_tokens).toBe(JUDGE_MAX_TOKENS);
  });

  it('rejects words that merely start with yes (word boundary)', async () => {
    vi.stubGlobal('fetch', mockFetchResponse('yesterday the code was correct'));
    const { passed, detail } = await llmJudge('question', 'code', 'key', 'model');
    expect(passed).toBe(false);
    expect(detail).toContain('unexpected verdict');
  });

  it('passes when yes has trailing punctuation', async () => {
    vi.stubGlobal('fetch', mockFetchResponse('yes.\n\nThe Auth0Provider wrapper is present.'));
    const { passed } = await llmJudge('question', 'code', 'key', 'model');
    expect(passed).toBe(true);
  });

  it('fails when no has trailing punctuation', async () => {
    vi.stubGlobal('fetch', mockFetchResponse('no, the provider is missing.'));
    const { passed, detail } = await llmJudge('question', 'code', 'key', 'model');
    expect(passed).toBe(false);
    expect(detail).not.toContain('unexpected verdict');
  });

  it('unexpected token returns error detail', async () => {
    vi.stubGlobal('fetch', mockFetchResponse('maybe'));
    const { passed, detail } = await llmJudge('question', 'code', 'key', 'model');
    expect(passed).toBe(false);
    expect(detail).toContain('unexpected verdict');
    expect(detail).toContain('maybe');
  });
});

// ── allowedLevels filtering ───────────────────────────────────────────────────

describe('runGraders - allowedLevels', () => {
  it('runs all graders when allowedLevels is not provided', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import Auth0 from '@auth0/auth0-react';");
    const graders = [
      contains('@auth0/auth0-react', 'L1 check', GraderLevel.L1),
      contains('useAuth0', 'L4 check', GraderLevel.L4),
      contains('Auth0', 'untagged holistic check'),
    ];

    const results = await runGraders(graders, dir, 'unused');

    expect(results.length).toBe(3);
  });

  it('runs only graders whose level is in the set when allowedLevels is provided', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import Auth0 from '@auth0/auth0-react';");
    const graders = [
      contains('@auth0/auth0-react', 'L1 check', GraderLevel.L1),
      contains('useAuth0', 'L4 check', GraderLevel.L4),
    ];
    const allowed = new Set([GraderLevel.L1, GraderLevel.L2, GraderLevel.L3]);

    const results = await runGraders(graders, dir, 'unused', undefined, allowed);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('L1 check');
  });

  it('always includes untagged graders even when allowedLevels is provided', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import Auth0 from '@auth0/auth0-react';");
    const graders = [
      contains('@auth0/auth0-react', 'L1 check', GraderLevel.L1),
      contains('Auth0', 'holistic check'), // no level — must always run
    ];
    const allowed = new Set([GraderLevel.L1, GraderLevel.L2, GraderLevel.L3]);

    const results = await runGraders(graders, dir, 'unused', undefined, allowed);

    expect(results.length).toBe(2);
    expect(results.map((r) => r.name)).toContain('holistic check');
  });

  it('includes untagged graders when allowedLevels is undefined (agent mode)', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import Auth0 from '@auth0/auth0-react';");
    const graders = [
      contains('@auth0/auth0-react', 'L1 check', GraderLevel.L1),
      contains('Auth0', 'holistic check'), // no level
    ];

    const results = await runGraders(graders, dir, 'unused');

    expect(results.length).toBe(2);
  });

  it('preserves level on GraderResult', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), "import Auth0 from '@auth0/auth0-react';");
    const graders = [contains('@auth0/auth0-react', 'L1 check', GraderLevel.L1), contains('Auth0', 'holistic check')];

    const results = await runGraders(graders, dir, 'unused');

    expect(results[0].level).toBe(GraderLevel.L1);
    expect(results[1].level).toBeUndefined();
  });

  it('filters out-of-range leveled graders but still runs untagged graders', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'App.js'), 'some code');
    const graders = [contains('token', 'L4 check', GraderLevel.L4), contains('token', 'holistic check')];
    const allowed = new Set([GraderLevel.L1, GraderLevel.L2, GraderLevel.L3]);

    const results = await runGraders(graders, dir, 'unused', undefined, allowed);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('holistic check');
  });
});
