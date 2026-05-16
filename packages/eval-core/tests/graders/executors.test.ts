import { describe, it, expect } from 'vitest';
import { GraderLevel } from '@a0/eval-graders';
import type { GraderDef } from '@a0/eval-graders';
import { containsExecutor } from '../../src/graders/executors/contains.js';
import { notContainsExecutor } from '../../src/graders/executors/not-contains.js';
import { notContainsInSourceExecutor } from '../../src/graders/executors/not-contains-in-source.js';
import { matchesExecutor } from '../../src/graders/executors/matches.js';
import type { GraderContext } from '../../src/graders/executors/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(files: Record<string, string>): GraderContext {
  const combinedText = Object.entries(files)
    .map(([path, content]) => `// FILE: ${path}\n${content}`)
    .join('\n\n');
  return {
    workspace: '/tmp/test',
    files,
    combinedText,
    combinedLower: combinedText.toLowerCase(),
  };
}

function makeDef(overrides: Partial<GraderDef> & { kind: string }): GraderDef {
  return { name: 'test grader', ...overrides };
}

// ── contains ──────────────────────────────────────────────────────────────────

describe('containsExecutor', () => {
  it('passes when needle is present in workspace files', async () => {
    const ctx = makeCtx({ 'app.ts': "import { Auth0Provider } from '@auth0/auth0-react';" });
    const def = makeDef({ kind: 'contains', needle: 'Auth0Provider', level: GraderLevel.L1 });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("'Auth0Provider' found in written files");
  });

  it('fails when needle is not present', async () => {
    const ctx = makeCtx({ 'app.ts': 'console.log("hello")' });
    const def = makeDef({ kind: 'contains', needle: 'Auth0Provider' });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('NOT found');
  });

  it('is case-sensitive by default', async () => {
    const ctx = makeCtx({ 'app.ts': 'auth0provider' });
    const def = makeDef({ kind: 'contains', needle: 'Auth0Provider' });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('supports case-insensitive search', async () => {
    const ctx = makeCtx({ 'app.ts': 'auth0provider' });
    const def = makeDef({ kind: 'contains', needle: 'Auth0Provider', caseSensitive: false });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('searches across multiple files', async () => {
    const ctx = makeCtx({ 'a.ts': 'foo', 'b.ts': 'bar', 'c.ts': 'baz' });
    const def = makeDef({ kind: 'contains', needle: 'bar' });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('preserves grader metadata in result', async () => {
    const ctx = makeCtx({ 'app.ts': 'Auth0Provider' });
    const def = makeDef({
      kind: 'contains',
      needle: 'Auth0Provider',
      name: 'has Auth0Provider',
      level: GraderLevel.L1,
    });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.name).toBe('has Auth0Provider');
    expect(result.kind).toBe('contains');
    expect(result.level).toBe(GraderLevel.L1);
  });
});

// ── not_contains ──────────────────────────────────────────────────────────────

describe('notContainsExecutor', () => {
  it('passes when needle is absent from workspace files', async () => {
    const ctx = makeCtx({ 'app.ts': "import { useAuth0 } from '@auth0/auth0-react';" });
    const def = makeDef({ kind: 'not_contains', needle: 'fake-package' });
    const result = await notContainsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('NOT found (good)');
  });

  it('fails when needle is present', async () => {
    const ctx = makeCtx({ 'app.ts': "import fake from 'fake-package';" });
    const def = makeDef({ kind: 'not_contains', needle: 'fake-package' });
    const result = await notContainsExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('FOUND (bad)');
  });

  it('is case-sensitive by default', async () => {
    const ctx = makeCtx({ 'app.ts': 'FAKE-PACKAGE' });
    const def = makeDef({ kind: 'not_contains', needle: 'fake-package' });
    const result = await notContainsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('supports case-insensitive search', async () => {
    const ctx = makeCtx({ 'app.ts': 'FAKE-PACKAGE' });
    const def = makeDef({ kind: 'not_contains', needle: 'fake-package', caseSensitive: false });
    const result = await notContainsExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });
});

// ── not_contains_in_source ────────────────────────────────────────────────────

describe('notContainsInSourceExecutor', () => {
  it('passes when needle is absent from source files', async () => {
    const ctx = makeCtx({ 'app.ts': 'const x = 1;' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('fails when needle is found in a source file', async () => {
    const ctx = makeCtx({ 'app.ts': 'const secret = "MY_SECRET";' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('allows needle in config files (.env)', async () => {
    const ctx = makeCtx({ '.env': 'AUTH0_SECRET=MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .json config files', async () => {
    const ctx = makeCtx({ 'config.json': '{"secret": "MY_SECRET"}' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .yaml config files', async () => {
    const ctx = makeCtx({ 'config.yaml': 'secret: MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .yml config files', async () => {
    const ctx = makeCtx({ 'config.yml': 'secret: MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .env.local files', async () => {
    const ctx = makeCtx({ '.env.local': 'SECRET=MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .toml config files', async () => {
    const ctx = makeCtx({ 'config.toml': 'secret = "MY_SECRET"' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('fails when needle is in source but passes for config — mixed files', async () => {
    const ctx = makeCtx({
      '.env': 'SECRET=MY_SECRET',
      'app.ts': 'const secret = "MY_SECRET";',
    });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('passes when needle is only in config — mixed files', async () => {
    const ctx = makeCtx({
      '.env': 'SECRET=MY_SECRET',
      'app.ts': 'const x = process.env.SECRET;',
    });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('is case-sensitive by default', async () => {
    const ctx = makeCtx({ 'app.ts': 'my_secret' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('supports case-insensitive search', async () => {
    const ctx = makeCtx({ 'app.ts': 'my_secret' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET', caseSensitive: false });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('handles nested path correctly — extracts basename', async () => {
    const ctx = makeCtx({ 'src/config/settings.json': '{"key": "MY_SECRET"}' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it.each(['.plist', '.xml', '.ini', '.cfg', '.conf'])('allows needle in %s config files', async (ext) => {
    const ctx = makeCtx({ [`config${ext}`]: 'secret: MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in nested .env.production files via prefix match', async () => {
    const ctx = makeCtx({ 'config/.env.production': 'SECRET=MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });
});

// ── matches ───────────────────────────────────────────────────────────────────

describe('matchesExecutor', () => {
  it('passes when regex pattern matches workspace content', async () => {
    const ctx = makeCtx({ 'app.ts': "import { useAuth0 } from '@auth0/auth0-react';" });
    const def = makeDef({ kind: 'matches', pattern: 'useAuth0' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('matched');
  });

  it('fails when regex pattern does not match', async () => {
    const ctx = makeCtx({ 'app.ts': 'console.log("hello")' });
    const def = makeDef({ kind: 'matches', pattern: 'useAuth0' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('NOT matched');
  });

  it('supports regex syntax', async () => {
    const ctx = makeCtx({ 'app.ts': 'const clientId = "abc123";' });
    const def = makeDef({ kind: 'matches', pattern: 'clientId\\s*=\\s*"[a-z0-9]+"' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('uses case-insensitive and multiline flags by default', async () => {
    const ctx = makeCtx({ 'app.ts': 'AUTH0PROVIDER' });
    const def = makeDef({ kind: 'matches', pattern: 'auth0provider' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('handles invalid regex gracefully', async () => {
    const ctx = makeCtx({ 'app.ts': 'some content' });
    const def = makeDef({ kind: 'matches', pattern: '[invalid(' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('invalid regex');
  });

  it('matches across multiple lines', async () => {
    const ctx = makeCtx({ 'app.ts': 'line1\nline2\nAuth0Provider\nline4' });
    const def = makeDef({ kind: 'matches', pattern: '^Auth0Provider$' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });
});
