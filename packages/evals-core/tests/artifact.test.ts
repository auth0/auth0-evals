import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import {
  writeRunArtifact,
  readRunArtifact,
  readRunArtifactManifest,
  findRunArtifacts,
  restoreArtifactWorkspace,
  RUN_ARTIFACT_SCHEMA_VERSION,
} from '../src/artifact/index.js';
import { collectFiles, listFiles } from '../src/workspace/file-utils.js';
import { collectFiles as collectGraderFiles } from '../src/graders/engine.js';
import type { RunRecord } from '../src/types/scorer.js';

const tmp = makeTmpDir('artifact_');

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    taskName: 't',
    model: 'claude-sonnet-5',
    evalType: 'sdk',
    sessionId: 'abc123',
    startTime: 1000.25,
    endTime: 1042.5,
    toolCalls: [
      {
        name: 'run_command',
        args: { command: 'npm install', token: 'sk-live-unredacted-secret', nested: { n: 1, ok: true } },
        result: 'added 1 package\nAUTH0_SECRET=hunter2',
        startTime: 1001,
        endTime: 1003.5,
        isDocLookup: false,
        isInterruption: false,
        causedError: false,
        actionType: 'Implementation',
        isRetry: false,
        recoveredFromError: false,
        errorCategory: undefined,
      },
    ],
    turnMetrics: [
      {
        turn: 1,
        inputTokens: 10,
        outputTokens: 5,
        llmLatency: 0.123,
        finishReason: 'stop',
        toolCallCount: 1,
        costUsd: 0.000123,
      },
    ],
    providerErrors: ['boom'],
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.5,
    status: 'success',
    finalSummary: 'Done ✓ — ünïcode',
    workspace: '/tmp/ws',
    ...overrides,
  };
}

function makeWorkspace(): string {
  const ws = tmp();
  const put = (rel: string, content: string | Buffer) => {
    const p = join(ws, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  };
  put('src/App.tsx', 'export const App = () => null;\n');
  put('src/dist/x.js', 'nested dist');
  put('node_modules/pkg/index.js', 'excluded');
  put('dist/out.js', 'excluded');
  put('.git/config', 'excluded');
  put('.claude/skills/a/SKILL.md', 'injected');
  put('.env', 'AUTH0_SECRET=hunter2\n');
  put('CLAUDE.md', 'guidance');
  put('bin.dat', Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, 0xa0, 0xa1, 0x00, 0x01]));
  return ws;
}

const BASE = { evalId: 'e1', category: 'quickstarts', model: 'claude-sonnet-5', tools: ['skills'] };

describe('run artefact', () => {
  it('round-trips an agent artefact faithfully', () => {
    const ws = makeWorkspace();
    const dir = join(tmp(), 'a');
    const record = makeRecord();
    const compileResult = { ok: false, exitCode: 2, signal: null, output: 'error TS1\n' };
    const skillFiles = [{ skill: 's', relPath: 'SKILL.md', content: '# skill\n' }];
    writeRunArtifact(dir, {
      ...BASE,
      kind: 'agent',
      mode: 'agent',
      agentType: 'claude-code',
      workspace: ws,
      record,
      resolvedModel: 'claude-sonnet-5-resolved',
      compileResult,
      skillFiles,
    });

    const art = readRunArtifact(dir);
    expect(art.kind).toBe('agent');
    if (art.kind !== 'agent') throw new Error('unreachable');
    expect(art.run.record).toEqual(record);
    expect(art.run.resolvedModel).toBe('claude-sonnet-5-resolved');
    expect(art.run.compileResult).toEqual(compileResult);
    expect(art.run.skillFiles).toEqual(skillFiles);
    expect(art.manifest).toMatchObject({
      schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
      kind: 'agent',
      evalId: 'e1',
      mode: 'agent',
      agentType: 'claude-code',
      tools: ['skills'],
      workspaceTruncated: false,
    });
    expect(Number.isNaN(Date.parse(art.manifest.createdAt))).toBe(false);
    // Nothing is redacted: graders need the raw trace.
    expect(readFileSync(join(dir, 'run.json'), 'utf-8')).toContain('sk-live-unredacted-secret');
  });

  it('round-trips baseline and error artefacts', () => {
    const base = join(tmp(), 'b');
    const result = {
      evalId: 'e1',
      model: 'm',
      mode: 'baseline',
      sessionId: 's',
      responseText: 'hello',
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0.01,
      wallTime: 1.5,
      status: 'failure' as const,
      error: 'x',
    };
    writeRunArtifact(base, { ...BASE, tools: [], kind: 'baseline', mode: 'baseline', result, responseText: 'hello' });
    const b = readRunArtifact(base);
    expect(b.kind === 'baseline' && b.run).toEqual({ result, responseText: 'hello' });
    expect(() => restoreArtifactWorkspace(readRunArtifact(base))).toThrow(/no workspace/);

    const err = join(tmp(), 'e');
    writeRunArtifact(err, { ...BASE, kind: 'error', mode: 'agent', agentType: 'codex', error: 'Error: bad' });
    const e = readRunArtifact(err);
    expect(e.kind === 'error' && e.run).toEqual({ error: 'Error: bad' });
    expect(e.manifest.agentType).toBe('codex');
  });

  it('rejects unknown schema versions, kinds and missing manifests', () => {
    const dir = join(tmp(), 'v');
    writeRunArtifact(dir, { ...BASE, kind: 'error', mode: 'agent', error: 'x' });
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;

    writeFileSync(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 2 }));
    expect(() => readRunArtifact(dir)).toThrow(/Unsupported run artefact schemaVersion 2/);

    writeFileSync(manifestPath, JSON.stringify({ ...manifest, kind: 'mystery' }));
    expect(() => readRunArtifact(dir)).toThrow(/Invalid run artefact kind/);

    expect(() => readRunArtifact(join(tmp(), 'nope'))).toThrow(/not found/);
  });

  it('writes the manifest last and atomically', () => {
    const dir = join(tmp(), 'm');
    // Simulate a crash mid-write: run.json exists but no manifest -> not an artefact.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), '{"error":"x"}');
    expect(findRunArtifacts(dir)).toEqual([]);
    expect(() => readRunArtifact(dir)).toThrow(/incomplete/);

    writeRunArtifact(dir, { ...BASE, kind: 'error', mode: 'agent', error: 'x' });
    expect(findRunArtifacts(dir)).toEqual([dir]);
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('removes a stale manifest before rewriting, so a failed rewrite is not "complete"', () => {
    const dir = join(tmp(), 'rw');
    writeRunArtifact(dir, { ...BASE, kind: 'error', mode: 'agent', error: 'first' });
    expect(() =>
      writeRunArtifact(dir, {
        ...BASE,
        kind: 'agent',
        mode: 'agent',
        workspace: join(tmp(), 'missing-workspace'),
        record: makeRecord(),
        resolvedModel: 'm',
      }),
    ).toThrow();
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false);
  });

  it('findRunArtifacts finds nested artefacts, sorted, without descending into them', () => {
    const root = tmp();
    const ws = makeWorkspace();
    // A workspace file called manifest.json must not confuse discovery.
    writeFileSync(join(ws, 'manifest.json'), '{}');
    writeRunArtifact(join(root, 'b'), { ...BASE, kind: 'error', mode: 'agent', error: 'x' });
    writeRunArtifact(join(root, 'nested/a'), {
      ...BASE,
      kind: 'agent',
      mode: 'agent',
      workspace: ws,
      record: makeRecord(),
      resolvedModel: 'm',
    });
    expect(findRunArtifacts(root)).toEqual([join(root, 'b'), join(root, 'nested/a')]);
    expect(findRunArtifacts(join(root, 'does-not-exist'))).toEqual([]);
  });

  it('copies the workspace byte-exact, including non-UTF-8 binaries', () => {
    const ws = makeWorkspace();
    const dir = join(tmp(), 'bin');
    writeRunArtifact(dir, {
      ...BASE,
      kind: 'agent',
      mode: 'agent',
      workspace: ws,
      record: makeRecord(),
      resolvedModel: 'm',
    });
    const restored = restoreArtifactWorkspace(readRunArtifact(dir));
    expect(readFileSync(join(restored, 'bin.dat'))).toEqual(readFileSync(join(ws, 'bin.dat')));
    expect(readFileSync(join(restored, '.env'), 'utf-8')).toBe('AUTH0_SECRET=hunter2\n');
  });

  it('restored workspace lists exactly the same files as the original (exclusion parity)', () => {
    const ws = makeWorkspace();
    const dir = join(tmp(), 'parity');
    writeRunArtifact(dir, {
      ...BASE,
      kind: 'agent',
      mode: 'agent',
      workspace: ws,
      record: makeRecord(),
      resolvedModel: 'm',
    });
    const restored = restoreArtifactWorkspace(readRunArtifact(dir));
    const original = collectFiles(ws, ws);
    expect(collectFiles(restored, restored)).toEqual(original);
    // Engine-level view (what graders see) is identical too.
    expect(collectGraderFiles(restored)).toEqual(collectGraderFiles(ws));
    expect(original).toContain('.env');
    expect(original).toContain('.claude/skills/a/SKILL.md'); // walker keeps it; the engine filters it
    expect(original).not.toContain('node_modules/pkg/index.js');
    expect(original).not.toContain('src/dist/x.js'); // the walker excludes `dist` at any depth
    expect(original.some((f) => f.startsWith('.git/'))).toBe(false);
    expect(Object.keys(collectGraderFiles(ws))).not.toContain('CLAUDE.md');
    // Re-grading the same artefact twice works; restoring does not mutate it.
    expect(restoreArtifactWorkspace(readRunArtifact(dir))).toBe(restored);
    expect(collectFiles(restored, restored)).toEqual(original);
  });

  it('re-truncates identically when the workspace exceeds the file cap', () => {
    const ws = tmp();
    for (let i = 0; i < 230; i++) {
      const p = join(ws, `d${i % 7}`, `f${String(i).padStart(3, '0')}.txt`);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, `file ${i}`);
    }
    const original = collectFiles(ws, ws);
    expect(original[original.length - 1]).toMatch(/truncated at 200 files/);

    const dir = join(tmp(), 'trunc');
    writeRunArtifact(dir, {
      ...BASE,
      kind: 'agent',
      mode: 'agent',
      workspace: ws,
      record: makeRecord(),
      resolvedModel: 'm',
    });
    const art = readRunArtifact(dir);
    expect(art.manifest.workspaceTruncated).toBe(true);
    expect(art.manifest.workspaceFiles).toHaveLength(200);
    const restored = restoreArtifactWorkspace(readRunArtifact(dir));
    expect(collectFiles(restored, restored)).toEqual(original);
    expect(collectGraderFiles(restored)).toEqual(collectGraderFiles(ws));
  });

  it('detects a snapshot with a file missing', () => {
    const ws = makeWorkspace();
    const dir = join(tmp(), 'corrupt');
    writeRunArtifact(dir, {
      ...BASE,
      kind: 'agent',
      mode: 'agent',
      workspace: ws,
      record: makeRecord(),
      resolvedModel: 'm',
    });
    expect(() => restoreArtifactWorkspace(readRunArtifact(dir))).not.toThrow();
    rmSync(join(dir, 'workspace', 'src', 'App.tsx'));
    expect(() => restoreArtifactWorkspace(readRunArtifact(dir))).toThrow(/workspace file missing: src\/App.tsx/);
  });

  // Root ignores file permissions, so the unreadable file would be copied anyway.
  it.skipIf(process.getuid?.() === 0)('skips an unreadable workspace file instead of failing the run', () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, 'locked.txt'), 'secret');
    chmodSync(join(ws, 'locked.txt'), 0o000);
    const dir = join(tmp(), 'unreadable');
    try {
      writeRunArtifact(dir, {
        ...BASE,
        kind: 'agent',
        mode: 'agent',
        workspace: ws,
        record: makeRecord(),
        resolvedModel: 'm',
      });
    } finally {
      chmodSync(join(ws, 'locked.txt'), 0o644);
    }
    const artifact = readRunArtifact(dir);
    expect(artifact.manifest.workspaceSkipped).toEqual(['locked.txt']);
    expect(artifact.manifest.workspaceFiles).not.toContain('locked.txt');
    expect(artifact.manifest.workspaceFiles).toContain('src/App.tsx');
    // Graders skip unreadable files too, so the file map they see is unchanged.
    const restored = restoreArtifactWorkspace(artifact);
    const original = collectGraderFiles(ws);
    delete original['locked.txt'];
    expect(collectGraderFiles(restored)).toEqual(original);
  });

  it('listFiles is the same walk as collectFiles, with truncation as a flag', () => {
    const ws = tmp();
    for (const name of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(ws, name), name);
    const listed = collectFiles(ws, ws, { maxFiles: 2 });
    expect(listed[listed.length - 1]).toBe('… (truncated at 2 files)');
    expect(listFiles(ws, ws, { maxFiles: 2 })).toEqual({ files: listed.slice(0, -1), truncated: true, maxFiles: 2 });
    expect(listFiles(ws, ws)).toEqual({ files: collectFiles(ws, ws), truncated: false, maxFiles: 200 });
  });

  it('skips an incomplete artefact without reading files inside its workspace', () => {
    const root = tmp();
    // Writer stopped before manifest.json; the agent's workspace has its own manifest.json.
    const incomplete = join(root, 'incomplete');
    mkdirSync(join(incomplete, 'workspace', 'public'), { recursive: true });
    writeFileSync(join(incomplete, 'workspace', 'public', 'manifest.json'), '{"name":"my-app"}');
    const runOnly = join(root, 'run-only');
    mkdirSync(runOnly, { recursive: true });
    writeFileSync(join(runOnly, 'run.json'), '{}');
    const complete = join(root, 'complete');
    writeRunArtifact(complete, { ...BASE, kind: 'error', mode: 'agent', error: 'x' });

    expect(findRunArtifacts(root)).toEqual([complete]);
  });

  it('readRunArtifactManifest reads the manifest without parsing run.json', () => {
    const dir = join(tmp(), 'a');
    writeRunArtifact(dir, { ...BASE, kind: 'error', mode: 'agent', error: 'x' });
    writeFileSync(join(dir, 'run.json'), '{corrupt');
    expect(readRunArtifactManifest(dir)).toMatchObject({ kind: 'error', evalId: BASE.evalId });
    expect(() => readRunArtifact(dir)).toThrow(/run.json/);
  });
});
