import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventToolCall } from '@a0/evals-graders';
import { makeTmpDir } from './tmp.js';
import { sealFixtureData, fixtureGradingFromArtifact, maskWorkspaceSecrets } from '../src/fixture/artifact-data.js';
import type { FixtureArtifactData } from '../src/fixture/artifact-data.js';
import { REDACTION_MARKER } from '../src/utils/redact.js';
import { writeRunArtifact, readRunArtifact } from '../src/artifact/artifact.js';

// Lets one test make the rewrite of a masked file fail; every other call goes to the real function.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
    readFileSync: vi.fn(actual.readFileSync),
    readdirSync: vi.fn(actual.readdirSync),
  };
});

const tmp = makeTmpDir('fixture_artifact_');

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const realWriteFileSync = realFs.writeFileSync;
const realReadFileSync = realFs.readFileSync;
const realReaddirSync = realFs.readdirSync;

const SECRET = 'xK9-very-secret-value-123';
// In a snapshot each distinct secret gets its own numbered marker.
const STATE_MARKER_1 = '[REDACTED SECRET 1]';
const STATE_MARKER_2 = '[REDACTED SECRET 2]';

function tool(args: Record<string, unknown>, result = ''): EventToolCall {
  return { name: 'Bash', args, result, causedError: false };
}

describe('sealFixtureData', () => {
  it('reports the exposure from the unmasked evidence and masks the same secret in the state', () => {
    const state = { pre: { clients: [] }, post: { clients: [{ client_secret: SECRET }] }, seeded: {} };
    const sealed = sealFixtureData(
      { state, secrets: [SECRET] },
      { toolCalls: [tool({ command: 'ls' }, `secret=${SECRET}`)], agentText: 'done', files: {} },
    );
    expect(sealed.exposure).toEqual({ checked: 1, locations: ['tool call 1 output'] });
    expect(sealed.state?.post).toEqual({ clients: [{ client_secret: STATE_MARKER_1 }] });
    expect(JSON.stringify(sealed)).not.toContain(SECRET);
  });

  it('keeps two different credentials different after masking, so a rotation check gives the same verdict', () => {
    const OLD = 'old-credential-1111';
    const NEW = 'new-credential-2222';
    const rotated = { pre: { cred: OLD }, post: { cred: NEW }, seeded: {} };
    const unchanged = { pre: { cred: OLD }, post: { cred: OLD }, seeded: {} };
    const evidence = { toolCalls: [], agentText: '', files: {} };

    const a = sealFixtureData({ state: rotated, secrets: [OLD, NEW] }, evidence).state as typeof rotated;
    const b = sealFixtureData({ state: unchanged, secrets: [OLD, NEW] }, evidence).state as typeof unchanged;

    expect(a.pre.cred).not.toBe(a.post.cred);
    expect(b.pre.cred).toBe(b.post.cred);
    expect(JSON.stringify([a, b])).not.toMatch(/credential-/);
  });

  it('masks a secret that contains another secret whole, with the marker of the longer one', () => {
    const short = 'abc-secret-core';
    const long = `${short}-with-a-tail`;
    const sealed = sealFixtureData(
      { state: { pre: {}, post: { v: `x=${long} y=${short}` }, seeded: {} }, secrets: [short, long] },
      { toolCalls: [], agentText: '', files: {} },
    );
    expect(sealed.state?.post).toEqual({ v: `x=${STATE_MARKER_2} y=${STATE_MARKER_1}` });
  });

  it.each([
    ['a top level key', { pre: {}, post: { [SECRET]: 1 }, seeded: {} }],
    ['a nested key', { pre: {}, post: { clients: [{ meta: { [`id-${SECRET}`]: true } }] }, seeded: {} }],
    ['a seeded key', { pre: {}, post: {}, seeded: { [SECRET]: 'x' } }],
  ])('throws, without quoting the key, when %s holds a secret', (_label, state) => {
    let thrown: Error | undefined;
    try {
      sealFixtureData({ state, secrets: [SECRET] }, { toolCalls: [], agentText: '', files: {} });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain('snapshot key contains a known secret');
    expect(thrown?.message).not.toContain(SECRET);
  });

  it('masks a secret inside a null-prototype snapshot object', () => {
    const post = Object.assign(Object.create(null), { token: SECRET, list: [{ v: `x ${SECRET}` }] });
    const sealed = sealFixtureData(
      { state: { pre: {}, post, seeded: {} }, secrets: [SECRET] },
      { toolCalls: [], agentText: '', files: {} },
    );
    expect(JSON.stringify(sealed)).not.toContain(SECRET);
    expect(JSON.stringify(sealed.state)).toContain(STATE_MARKER_1);
  });

  it('leaves ordinary keys unchanged', () => {
    const state = { pre: { 'client-id': 1 }, post: { 'client-id': 2 }, seeded: { appId: 'abc' } };
    const sealed = sealFixtureData({ state, secrets: [SECRET] }, { toolCalls: [], agentText: '', files: {} });
    expect(sealed.state).toEqual(state);
  });

  it('masks nested objects and arrays in pre, post and seeded', () => {
    const state = {
      pre: { a: { b: [`x ${SECRET} y`] } },
      post: [{ deep: { list: [SECRET, 'keep'] } }],
      seeded: { id: SECRET, n: 3 },
    };
    const sealed = sealFixtureData({ state, secrets: [SECRET] }, { agentText: '', files: {} });
    expect(sealed.state).toEqual({
      pre: { a: { b: [`x ${STATE_MARKER_1} y`] } },
      post: [{ deep: { list: [STATE_MARKER_1, 'keep'] } }],
      seeded: { id: STATE_MARKER_1, n: 3 },
    });
  });

  it('passes stateError through and keeps state undefined', () => {
    const sealed = sealFixtureData(
      { stateError: 'post-run snapshot failed', secrets: [SECRET] },
      { agentText: '', files: {} },
    );
    expect(sealed.state).toBeUndefined();
    expect('state' in sealed).toBe(false);
    expect(sealed.stateError).toBe('post-run snapshot failed');
    expect(sealed.exposure).toEqual({ checked: 1, locations: [] });
  });

  it('reports checked 0 when no secrets are known', () => {
    const sealed = sealFixtureData({ secrets: [] }, { agentText: SECRET, files: {} });
    expect(sealed.exposure).toEqual({ checked: 0, locations: [] });
    expect('stateError' in sealed).toBe(false);
  });

  it('does not mutate its inputs', () => {
    const state = { pre: {}, post: { s: SECRET }, seeded: {} };
    const secrets = [SECRET];
    const toolCalls = [tool({ command: SECRET })];
    const input = { state, secrets };
    const snapshot = JSON.stringify({ input, toolCalls });
    sealFixtureData(input, { toolCalls, agentText: SECRET, files: { 'a.ts': SECRET } });
    expect(JSON.stringify({ input, toolCalls })).toBe(snapshot);
    expect(state.post.s).toBe(SECRET);
  });
});

describe('fixtureGradingFromArtifact', () => {
  it('rebuilds the grading input with no secrets and the stored data', () => {
    const data: FixtureArtifactData = {
      state: { pre: { n: 1 }, post: { n: 2 }, seeded: { id: 'abc' } },
      exposure: { checked: 2, locations: ['final reply'] },
    };
    const input = fixtureGradingFromArtifact(data);
    expect(input.secrets).toEqual([]);
    expect(input.state).toBe(data.state);
    expect(input.exposure).toBe(data.exposure);
    expect(input.stateError).toBeUndefined();
  });

  it('carries stateError and leaves state undefined', () => {
    const input = fixtureGradingFromArtifact({
      stateError: 'post-run snapshot failed',
      exposure: { checked: 0, locations: [] },
    });
    expect(input.state).toBeUndefined();
    expect(input.stateError).toBe('post-run snapshot failed');
    expect(input.secrets).toEqual([]);
  });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

describe('maskWorkspaceSecrets', () => {
  afterEach(() => {
    vi.mocked(fs.writeFileSync).mockImplementation(realWriteFileSync);
    vi.mocked(fs.readFileSync).mockImplementation(realReadFileSync as never);
    vi.mocked(fs.readdirSync).mockImplementation(realReaddirSync as never);
  });

  function put(ws: string, rel: string, content: string): void {
    const p = join(ws, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }

  it('rewrites only files containing a secret and leaves clean files untouched', () => {
    const ws = tmp();
    put(ws, 'src/a.ts', `const s = '${SECRET}';\nconst t = '${SECRET}';\n`);
    put(ws, '.env', `CLIENT_SECRET=${SECRET}\n`);
    const clean = 'export const ok = 1;\r\n// no secret hereé\n';
    put(ws, 'src/clean.ts', clean);

    expect(maskWorkspaceSecrets(ws, [SECRET])).toBe(2);
    expect(readFileSync(join(ws, 'src/a.ts'), 'utf-8')).toBe(
      `const s = '${REDACTION_MARKER}';\nconst t = '${REDACTION_MARKER}';\n`,
    );
    expect(readFileSync(join(ws, '.env'), 'utf-8')).toBe(`CLIENT_SECRET=${REDACTION_MARKER}\n`);
    expect(readFileSync(join(ws, 'src/clean.ts'), 'utf-8')).toBe(clean);
  });

  it('returns 0 and changes nothing when no secret is known or none appears', () => {
    const ws = tmp();
    put(ws, 'a.ts', `value ${SECRET}`);
    expect(maskWorkspaceSecrets(ws, [])).toBe(0);
    expect(maskWorkspaceSecrets(ws, [''])).toBe(0);
    expect(readFileSync(join(ws, 'a.ts'), 'utf-8')).toBe(`value ${SECRET}`);
    expect(maskWorkspaceSecrets(ws, ['not-in-any-file-999'])).toBe(0);
  });

  it.each([
    ['a file name', `${SECRET}.txt`],
    ['a directory name', `${SECRET}/index.ts`],
  ])('deletes a file when %s holds a secret, and still masks the other files', (_label, rel) => {
    const ws = tmp();
    put(ws, rel, 'clean content');
    put(ws, 'src/a.ts', `const s = '${SECRET}';`);
    put(ws, 'src/clean.ts', 'export const ok = 1;');

    expect(maskWorkspaceSecrets(ws, [SECRET])).toBe(2);

    expect(existsSync(join(ws, rel))).toBe(false);
    expect(readFileSync(join(ws, 'src/a.ts'), 'utf-8')).toBe(`const s = '${REDACTION_MARKER}';`);
    expect(readFileSync(join(ws, 'src/clean.ts'), 'utf-8')).toBe('export const ok = 1;');
  });

  it('leaves no secret in the artefact paths or manifest after a file name held one', () => {
    const ws = tmp();
    put(ws, `${SECRET}.txt`, `token=${SECRET}`);
    put(ws, 'src/a.ts', 'export {};');
    maskWorkspaceSecrets(ws, [SECRET]);

    const dir = tmp();
    writeRunArtifact(dir, {
      kind: 'agent',
      evalId: 'x',
      category: 'c',
      model: 'm',
      mode: 'agent',
      tools: [],
      workspace: ws,
      record: { toolCalls: [] } as never,
      resolvedModel: 'm',
      compileResult: undefined,
      skillFiles: [],
    } as never);

    expect(readFileSync(join(dir, 'manifest.json'), 'utf-8')).not.toContain(SECRET);
    expect(readdirSync(join(dir, 'workspace'), { recursive: true }).join('\n')).not.toContain(SECRET);
    expect(readdirSync(join(dir, 'workspace'))).toEqual(['src']);
  });

  it('masks every file the artefact will copy even when deleting a path lets an unlisted file in', () => {
    // The listing stops at 200 files. One of 201 files has a secret in its path, so deleting it
    // brings the file that was cut off into the next listing, which is the one that gets copied.
    const ws = tmp();
    for (let i = 0; i < 200; i++) put(ws, `f${String(i).padStart(3, '0')}.txt`, `v=${SECRET}`);
    // Sorts before the others, so it is inside the first 200 and the last `f` file is cut off.
    put(ws, `0-${SECRET}.txt`, 'clean');
    // The listing order of a directory is not guaranteed, so make it alphabetical here.
    vi.mocked(fs.readdirSync).mockImplementation(((...args: unknown[]) => {
      const out = (realReaddirSync as (...a: unknown[]) => Array<string | { name: string }>)(...args);
      return [...out].sort((a, b) =>
        String(typeof a === 'string' ? a : a.name).localeCompare(typeof b === 'string' ? b : b.name),
      );
    }) as never);

    maskWorkspaceSecrets(ws, [SECRET]);

    const left = readdirSync(ws);
    expect(left.some((f) => f.includes(SECRET))).toBe(false);
    for (const f of left) expect(readFileSync(join(ws, f), 'utf-8')).not.toContain(SECRET);
    expect(left.length).toBeGreaterThan(0);
  });

  it('fails closed, without quoting the path, when a file is too large to read as text', () => {
    const ws = tmp();
    put(ws, 'big.log', 'x');
    vi.mocked(fs.readFileSync).mockImplementation(((p: unknown, ...rest: unknown[]) => {
      if (String(p).endsWith('big.log')) {
        throw Object.assign(new Error('Cannot create a string longer than 0x1fffffe8 characters'), {
          code: 'ERR_STRING_TOO_LONG',
        });
      }
      return (realReadFileSync as (...a: unknown[]) => unknown)(p, ...rest);
    }) as never);

    let thrown: Error | undefined;
    try {
      maskWorkspaceSecrets(ws, [SECRET]);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain('too large to read as text');
    expect(thrown?.message).not.toContain('big.log');
  });

  it('skips a file that cannot be read for another reason, like the copy does', () => {
    const ws = tmp();
    put(ws, 'denied.txt', 'x');
    put(ws, 'a.ts', `v=${SECRET}`);
    vi.mocked(fs.readFileSync).mockImplementation(((p: unknown, ...rest: unknown[]) => {
      if (String(p).endsWith('denied.txt')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return (realReadFileSync as (...a: unknown[]) => unknown)(p, ...rest);
    }) as never);

    expect(maskWorkspaceSecrets(ws, [SECRET])).toBe(1);
  });

  it('masks overlapping secrets longest first so no tail is left behind', () => {
    const ws = tmp();
    const short = 'abc-secret-core';
    const long = `${short}-with-a-tail`;
    put(ws, 'a.ts', `x=${long} y=${short}`);
    expect(maskWorkspaceSecrets(ws, [short, long])).toBe(1);
    const out = readFileSync(join(ws, 'a.ts'), 'utf-8');
    expect(out).toBe(`x=${REDACTION_MARKER} y=${REDACTION_MARKER}`);
    expect(out).not.toContain('tail');
  });

  it('ignores files outside the grading corpus such as node_modules', () => {
    const ws = tmp();
    put(ws, 'node_modules/pkg/index.js', `module.exports = '${SECRET}'`);
    put(ws, 'src/a.ts', `const s = '${SECRET}'`);
    expect(maskWorkspaceSecrets(ws, [SECRET])).toBe(1);
    expect(readFileSync(join(ws, 'node_modules/pkg/index.js'), 'utf-8')).toContain(SECRET);
  });

  // Root ignores file permissions, so the locked file would be readable anyway.
  it.skipIf(process.getuid?.() === 0)('skips an unreadable file and still masks the others', () => {
    const ws = tmp();
    put(ws, 'locked.txt', `value ${SECRET}`);
    put(ws, 'a.ts', `value ${SECRET}`);
    chmodSync(join(ws, 'locked.txt'), 0o000);
    try {
      expect(maskWorkspaceSecrets(ws, [SECRET])).toBe(1);
    } finally {
      chmodSync(join(ws, 'locked.txt'), 0o644);
    }
    expect(readFileSync(join(ws, 'a.ts'), 'utf-8')).toBe(`value ${REDACTION_MARKER}`);
  });

  // Root ignores file permissions, so a read only file would be writable anyway.
  it.skipIf(process.getuid?.() === 0)(
    'masks a read only file through the chmod retry and keeps it out of the artefact',
    () => {
      const ws = tmp();
      put(ws, '.env', `CLIENT_SECRET=${SECRET}\n`);
      chmodSync(join(ws, '.env'), 0o400);

      expect(maskWorkspaceSecrets(ws, [SECRET])).toBe(1);
      expect(readFileSync(join(ws, '.env'), 'utf-8')).toBe(`CLIENT_SECRET=${REDACTION_MARKER}\n`);

      const artifactDir = join(tmp(), 'run');
      writeRunArtifact(artifactDir, {
        kind: 'agent',
        evalId: 'e',
        category: 'cli',
        model: 'm',
        tools: [],
        mode: 'agent',
        workspace: ws,
        record: {
          taskName: 'e',
          model: 'm',
          sessionId: 's',
          startTime: 1,
          endTime: 2,
          toolCalls: [],
          turnMetrics: [],
          providerErrors: [],
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          status: 'success',
          workspace: ws,
        },
        resolvedModel: 'm',
      });
      const stored = filesUnder(artifactDir);
      expect(stored.length).toBeGreaterThan(1);
      for (const file of stored) expect(readFileSync(file, 'utf-8'), file).not.toContain(SECRET);
      expect(readRunArtifact(artifactDir).kind).toBe('agent');
    },
  );

  it('throws without naming the secret when a file with a secret cannot be rewritten', () => {
    const ws = tmp();
    put(ws, 'src/leaky.ts', `const s = '${SECRET}';`);
    vi.mocked(fs.writeFileSync).mockImplementation(((path: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(path).endsWith('leaky.ts')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return (realWriteFileSync as (...a: unknown[]) => void)(path, ...rest);
    }) as typeof fs.writeFileSync);

    let message = '';
    try {
      maskWorkspaceSecrets(ws, [SECRET]);
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain('src/leaky.ts');
    expect(message).toContain('known secret');
    expect(message).not.toContain(SECRET);
  });

  it('tolerates a workspace that does not exist', () => {
    expect(maskWorkspaceSecrets(join(tmp(), 'missing'), [SECRET])).toBe(0);
  });
});
