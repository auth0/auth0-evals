/**
 * Happy path tests for src/scorer.ts
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import type { RunRecord, ToolCallRecord, DimensionScore, ScoredResult } from '@a0/eval-core';
import { GraderLevel, type GraderResult } from '@a0/eval-graders';
import { collectGraderFiles } from '@a0/eval-core';
import { score, scoreToGrade } from '../src/scorer.js';
import { analyzeWaste } from '../src/waste.js';

// Auth0 doc URL allowlist used by tests that verify domain-scoring behaviour.
const AUTH0_DOC_SOURCES: readonly [string, string][] = [
  ['auth0.github.io', '/'],
  ['auth0.com', '/docs'],
  ['auth0.com', '/blog'],
  ['community.auth0.com', '/'],
  ['npmjs.com', '/package/@auth0'],
  ['github.com', '/auth0/'],
  ['github.com', '/auth0-samples'],
  ['jwt.io', '/'],
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    taskName: 'test-task',
    model: 'test-model',
    sessionId: 'abc12345',
    startTime: 0,
    endTime: 0,
    toolCalls: [makeToolCall()], // default: 1 tool call so process dimensions are active
    turnMetrics: [],
    providerErrors: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    status: 'success',
    finalSummary: '',
    workspace: '',
    ...overrides,
  };
}

function makeToolCall(name = 'read_file', duration = 1.0, overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    name,
    args: {},
    result: 'ok',
    startTime: 0,
    endTime: duration,
    isDocLookup: false,
    isInterruption: false,
    causedError: false,
    actionType: 'Implementation',
    isRetry: false,
    recoveredFromError: false,
    ...overrides,
  };
}

function getDim(result: ScoredResult, name: string): DimensionScore {
  const dim = result.dimensions.find((d) => d.name === name);
  if (!dim) throw new Error(`Dimension '${name}' not found`);
  return dim;
}

const tmpDir = makeTmpDir('scorer_test_');

// ── scoreToGrade tests ────────────────────────────────────────────────────────

describe('scoreToGrade', () => {
  it.each([
    [100.0, 'A'],
    [90.0, 'A'],
    [89.9, 'B'],
    [75.0, 'B'],
    [74.9, 'C'],
    [60.0, 'C'],
    [59.9, 'D'],
    [40.0, 'D'],
    [39.9, 'F'],
    [0.0, 'F'],
  ])('score %s → grade %s', (raw, expected) => {
    expect(scoreToGrade(raw)).toBe(expected);
  });
});

// ── Setup Friction tests ──────────────────────────────────────────────────────

describe('score - Setup Friction', () => {
  it('no interruptions and no errors = 100', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Setup Friction').rawScore).toBe(100.0);
  });

  it('penalises each interruption', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('ask_user', 1, { isInterruption: true }),
      makeToolCall('ask_user', 1, { isInterruption: true }),
    ];
    const result = score(record);
    expect(getDim(result, 'Setup Friction').rawScore).toBe(72.0); // 100 - 2 * 14
  });

  it('penalises provider errors', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir, providerErrors: ['timeout', 'rate limit'] });
    const result = score(record);
    expect(getDim(result, 'Setup Friction').rawScore).toBeLessThan(100.0);
  });

  it('clamps to zero', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = Array.from({ length: 10 }, () => makeToolCall('ask_user', 1, { isInterruption: true }));
    const result = score(record);
    expect(getDim(result, 'Setup Friction').rawScore).toBe(0.0);
  });
});

// ── Setup Speed tests ─────────────────────────────────────────────────────────

describe('score - Setup Speed', () => {
  it.each([
    [30.0, 100.0], // below reference
    [60.0, 100.0], // at exact reference
    [110.0, 80.0], // 50s over: 100 - 50*0.4
  ])('duration %fs → score %f', (duration, expectedScore) => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [makeToolCall('read_file', duration)];
    const result = score(record);
    expect(getDim(result, 'Setup Speed').rawScore).toBeCloseTo(expectedScore, 1);
  });
});

// ── Efficiency tests ──────────────────────────────────────────────────────────

describe('score - Efficiency', () => {
  it('no tool calls = zeroed out (agent did not execute)', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir, toolCalls: [] }));
    expect(getDim(result, 'Efficiency').rawScore).toBe(0);
  });

  it('zero waste = 100 regardless of call count', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    // 40 clean calls — no waste; old formula would have scored this 25
    record.toolCalls = Array.from({ length: 40 }, (_, i) =>
      makeToolCall(i % 2 === 0 ? 'write_file' : 'run_command', 1, {
        args: { path: `file${i}.ts` },
      }),
    );
    const result = score(record);
    expect(getDim(result, 'Efficiency').rawScore).toBe(100.0);
  });

  it('duplicate reads count as waste', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    // read same file twice, no write or run_command in between
    record.toolCalls = [
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
    ];
    const result = score(record);
    // 1 waste out of 2 = 50%
    expect(getDim(result, 'Efficiency').rawScore).toBe(50.0);
    expect(getDim(result, 'Efficiency').notes).toContain('dup read');
  });

  it('run_command between reads resets duplicate tracking', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
      makeToolCall('run_command', 1, { args: { command: 'npm install' } }),
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
    ];
    const result = score(record);
    // run_command resets tracking — second read is not a duplicate
    expect(getDim(result, 'Efficiency').rawScore).toBe(100.0);
  });

  it('errored calls count as waste', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('write_file', 1, { causedError: true }),
      makeToolCall('write_file', 1),
      makeToolCall('write_file', 1),
    ];
    const result = score(record);
    // 1 waste out of 3 ≈ 66.7
    expect(getDim(result, 'Efficiency').rawScore).toBeCloseTo(66.7, 0);
    expect(getDim(result, 'Efficiency').notes).toContain('error/retry');
  });

  it('retry calls count as waste', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [makeToolCall('run_command', 1, { isRetry: true }), makeToolCall('run_command', 1)];
    const result = score(record);
    // 1 waste out of 2 = 50
    expect(getDim(result, 'Efficiency').rawScore).toBe(50.0);
  });

  it('overwritten write counts first write as waste', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    // two consecutive writes to same path (no read between) = first is overwritten
    record.toolCalls = [
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'other.ts' } }),
    ];
    const result = score(record);
    // 1 waste (overwritten write) out of 3 ≈ 66.7
    expect(getDim(result, 'Efficiency').rawScore).toBeCloseTo(66.7, 0);
    expect(getDim(result, 'Efficiency').notes).toContain('overwritten write');
  });

  it('read between writes cancels overwrite tracking', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('read_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
    ];
    const result = score(record);
    // read between writes = first write was used, no overwrite waste
    expect(getDim(result, 'Efficiency').rawScore).toBe(100.0);
  });

  it('interruptions count as waste (double-counted with friction by design)', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('ask_user', 1, { isInterruption: true }),
      makeToolCall('write_file', 1),
      makeToolCall('write_file', 1),
      makeToolCall('write_file', 1),
    ];
    const result = score(record);
    // 1 waste out of 4 = 75
    expect(getDim(result, 'Efficiency').rawScore).toBe(75.0);
    expect(getDim(result, 'Efficiency').notes).toContain('interruption');
  });

  it('notes include tool summary', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = Array.from({ length: 3 }, () => makeToolCall('read_file', 1, { args: { path: 'unique' } }));
    const result = score(record);
    expect(getDim(result, 'Efficiency').notes).toContain('Read');
  });
});

// ── analyzeWaste unit tests ───────────────────────────────────────────────────

describe('analyzeWaste', () => {
  it('empty call list returns all zeros', () => {
    const result = analyzeWaste([]);
    expect(result).toEqual({
      totalCalls: 0,
      wasteCount: 0,
      duplicateReads: 0,
      erroredOrRetry: 0,
      overwrittenWrites: 0,
      interruptions: 0,
    });
  });

  it('clean calls have no waste', () => {
    const calls = [
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'b.ts' } }),
      makeToolCall('run_command', 1),
    ];
    const result = analyzeWaste(calls);
    expect(result.wasteCount).toBe(0);
  });

  it('duplicate read detected', () => {
    const calls = [
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
    ];
    const result = analyzeWaste(calls);
    expect(result.duplicateReads).toBe(1);
    expect(result.wasteCount).toBe(1);
  });

  it('run_command resets duplicate read tracking', () => {
    const calls = [
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
      makeToolCall('run_command', 1),
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
    ];
    expect(analyzeWaste(calls).duplicateReads).toBe(0);
  });

  it('write_file resets duplicate read tracking for that path', () => {
    const calls = [
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'a.ts' } }),
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
    ];
    expect(analyzeWaste(calls).duplicateReads).toBe(0);
  });

  it('errored call counted as waste', () => {
    const calls = [makeToolCall('run_command', 1, { causedError: true }), makeToolCall('run_command', 1)];
    const result = analyzeWaste(calls);
    expect(result.erroredOrRetry).toBe(1);
    expect(result.wasteCount).toBe(1);
  });

  it('retry call counted as waste', () => {
    const calls = [makeToolCall('run_command', 1, { isRetry: true }), makeToolCall('run_command', 1)];
    const result = analyzeWaste(calls);
    expect(result.erroredOrRetry).toBe(1);
    expect(result.wasteCount).toBe(1);
  });

  it('overwritten write detected', () => {
    const calls = [
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
    ];
    const result = analyzeWaste(calls);
    expect(result.overwrittenWrites).toBe(1);
    expect(result.wasteCount).toBe(1);
  });

  it('read between writes cancels overwrite tracking', () => {
    const calls = [
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('read_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
    ];
    expect(analyzeWaste(calls).overwrittenWrites).toBe(0);
  });

  it('interruption counted as waste', () => {
    const calls = [makeToolCall('ask_user', 1, { isInterruption: true }), makeToolCall('write_file', 1)];
    const result = analyzeWaste(calls);
    expect(result.interruptions).toBe(1);
    expect(result.wasteCount).toBe(1);
  });

  it('call matching multiple categories counted once in wasteCount', () => {
    // causedError + isRetry on same call — wasteCount should be 1, not 2
    const calls = [makeToolCall('run_command', 1, { causedError: true, isRetry: true })];
    const result = analyzeWaste(calls);
    expect(result.wasteCount).toBe(1);
    expect(result.erroredOrRetry).toBe(1);
  });

  it('errored read_file is not counted as duplicateRead', () => {
    // A read_file with causedError=true should appear in erroredOrRetry only,
    // not in duplicateReads — even though wasteFlags[i] is true.
    const calls = [makeToolCall('read_file', 1, { args: { path: 'a.ts' }, causedError: true })];
    const result = analyzeWaste(calls);
    expect(result.erroredOrRetry).toBe(1);
    expect(result.duplicateReads).toBe(0);
    expect(result.wasteCount).toBe(1);
  });

  it('overwrittenWrites is accurate when other categories also have waste', () => {
    // errored call + overwritten write — overwrittenWrites must be 1, not 0
    const calls = [
      makeToolCall('run_command', 1, { causedError: true }),
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
    ];
    const result = analyzeWaste(calls);
    expect(result.erroredOrRetry).toBe(1);
    expect(result.overwrittenWrites).toBe(1);
    expect(result.wasteCount).toBe(2);
  });

  it('write_file to different path does not reset duplicate-read tracking', () => {
    // write_file(b.ts) should not clear the read tracking for a.ts
    const calls = [
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
      makeToolCall('write_file', 1, { args: { path: 'b.ts' } }),
      makeToolCall('read_file', 1, { args: { path: 'a.ts' } }),
    ];
    const result = analyzeWaste(calls);
    expect(result.duplicateReads).toBe(1);
  });
});

// ── Error Recovery tests ──────────────────────────────────────────────────────

describe('score - Error Recovery', () => {
  it('no provider errors = 100', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Error Recovery').rawScore).toBe(100.0);
  });

  it('penalises provider errors', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir, providerErrors: ['timeout'] });
    const result = score(record);
    expect(getDim(result, 'Error Recovery').rawScore).toBeLessThan(100.0);
  });

  it('clamps to zero', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir, providerErrors: Array.from({ length: 10 }, (_, i) => `err${i}`) });
    const result = score(record);
    expect(getDim(result, 'Error Recovery').rawScore).toBe(0.0);
  });
});

// ── Correctness tests ─────────────────────────────────────────────────────────

describe('score - Correctness', () => {
  it('all passing = 100', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [
      { name: 'a', kind: 'contains', passed: true, detail: '' },
      { name: 'b', kind: 'contains', passed: true, detail: '' },
    ];
    const result = score(makeRecord({ workspace: dir }), graderResults);
    expect(getDim(result, 'Correctness').rawScore).toBe(100.0);
  });

  it('half passing = 50', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [
      { name: 'a', kind: 'contains', passed: true, detail: '' },
      { name: 'b', kind: 'contains', passed: false, detail: '' },
    ];
    const result = score(makeRecord({ workspace: dir }), graderResults);
    expect(getDim(result, 'Correctness').rawScore).toBe(50.0);
  });

  it('none passing = 0', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [{ name: 'a', kind: 'contains', passed: false, detail: '' }];
    const result = score(makeRecord({ workspace: dir }), graderResults);
    expect(getDim(result, 'Correctness').rawScore).toBe(0.0);
  });

  it('empty graders = 0', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), []);
    expect(getDim(result, 'Correctness').rawScore).toBe(0.0);
  });

  it('excludes L2 graders from correctness (no double-counting with Hallucination)', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [
      { name: 'l1-pass', kind: 'contains', passed: true, detail: '', level: GraderLevel.L1 },
      { name: 'l2-fail', kind: 'notContains', passed: false, detail: 'hallucinated pkg', level: GraderLevel.L2 },
    ];
    const result = score(makeRecord({ workspace: dir }), graderResults);
    // Only the L1 grader should count toward Correctness
    expect(getDim(result, 'Correctness').rawScore).toBe(100.0);
    // The L2 failure should only appear in Hallucination
    expect(getDim(result, 'Hallucination').rawScore).toBe(0.0);
  });

  it('excludes L3 graders from correctness (no double-counting with Security)', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [
      { name: 'l1-pass', kind: 'contains', passed: true, detail: '', level: GraderLevel.L1 },
      { name: 'l3-fail', kind: 'notContains', passed: false, detail: 'hardcoded secret', level: GraderLevel.L3 },
    ];
    const result = score(makeRecord({ workspace: dir }), graderResults);
    // Only the L1 grader should count toward Correctness
    expect(getDim(result, 'Correctness').rawScore).toBe(100.0);
    // The L3 failure should only appear in Security
    expect(getDim(result, 'Security').rawScore).toBe(0.0);
  });

  it('includes L4 and L5 graders in correctness', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [
      { name: 'l1-pass', kind: 'contains', passed: true, detail: '', level: GraderLevel.L1 },
      { name: 'l4-fail', kind: 'contains', passed: false, detail: 'structural issue', level: GraderLevel.L4 },
      { name: 'l5-pass', kind: 'contains', passed: true, detail: '', level: GraderLevel.L5 },
    ];
    const result = score(makeRecord({ workspace: dir }), graderResults);
    // 2 of 3 non-L2/L3 graders passed
    expect(getDim(result, 'Correctness').rawScore).toBeCloseTo(66.7, 0);
  });
});

// ── Hallucination tests ───────────────────────────────────────────────────────

describe('score - Hallucination', () => {
  it('clean react code = 100', () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, 'App.jsx'),
      "import { useAuth0, Auth0Provider } from '@auth0/auth0-react';\nexport default function App() { return <div/>; }",
    );
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Hallucination').rawScore).toBe(100.0);
  });

  it('detects fake python import', () => {
    const dir = tmpDir();
    const graders: GraderResult[] = [
      {
        name: 'no-fake-client',
        kind: 'notContains',
        passed: false,
        detail: "app.py: Auth0Client doesn't exist in auth0 package",
        level: GraderLevel.L2,
      },
    ];
    const result = score(makeRecord({ workspace: dir }), graders);
    const dim = getDim(result, 'Hallucination');
    expect(dim.rawScore).toBeLessThan(100.0);
    expect(dim.notes).toContain('app.py');
  });

  it('detects fake js package', () => {
    const dir = tmpDir();
    const graders: GraderResult[] = [
      {
        name: 'no-fake-sdk',
        kind: 'notContains',
        passed: false,
        detail: "@auth0/auth0-sdk doesn't exist",
        level: GraderLevel.L2,
      },
    ];
    const result = score(makeRecord({ workspace: dir }), graders);
    expect(getDim(result, 'Hallucination').rawScore).toBeLessThan(100.0);
  });

  it('empty workspace = 100', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Hallucination').rawScore).toBe(100.0);
  });

  it('ignores hallucinations inside node_modules', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'node_modules', 'some-pkg', 'src'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'some-pkg', 'src', 'index.js'), 'import @auth0/auth0-sdk\n');
    writeFileSync(join(dir, 'app.js'), 'console.log("clean")');
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Hallucination').rawScore).toBe(100.0);
  });
});

// ── Security tests ────────────────────────────────────────────────────────────

describe('score - Security', () => {
  it('env vars only = 100', () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, 'App.js'),
      'const domain = process.env.REACT_APP_AUTH0_DOMAIN;\nconst clientId = process.env.REACT_APP_AUTH0_CLIENT_ID;',
    );
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Security').rawScore).toBe(100.0);
  });

  it('detects hardcoded client_secret', () => {
    const dir = tmpDir();
    const graders: GraderResult[] = [
      {
        name: 'no-client-secret',
        kind: 'notContains',
        passed: false,
        detail: 'auth.js: Hardcoded client_secret',
        level: GraderLevel.L3,
      },
    ];
    const result = score(makeRecord({ workspace: dir }), graders);
    const dim = getDim(result, 'Security');
    expect(dim.rawScore).toBeLessThan(100.0);
    expect(dim.notes).toContain('auth.js');
  });

  it('detects hardcoded api_key', () => {
    const dir = tmpDir();
    const graders: GraderResult[] = [
      {
        name: 'no-api-key',
        kind: 'notContains',
        passed: false,
        detail: 'config.js: Hardcoded API key',
        level: GraderLevel.L3,
      },
    ];
    const result = score(makeRecord({ workspace: dir }), graders);
    expect(getDim(result, 'Security').rawScore).toBeLessThan(100.0);
  });

  it('empty workspace = 100', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Security').rawScore).toBe(100.0);
  });

  it('ignores credentials inside node_modules', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'node_modules', 'some-pkg', 'src'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'some-pkg', 'src', 'auth.ts'), "const password = 'hunter2';");
    writeFileSync(join(dir, 'app.ts'), 'console.log("clean")');
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Security').rawScore).toBe(100.0);
  });
});

// ── Docs Quality tests ────────────────────────────────────────────────────────

describe('score - Docs Quality', () => {
  it('no doc lookups = 100', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Docs Quality').rawScore).toBe(100.0);
    expect(getDim(result, 'Docs Quality').notes).toContain('No doc lookups');
  });

  it('valid auth0 domain + no error + no rewrite + no L4 graders = 100', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://auth0.com/docs/quickstart/spa/react' },
      }),
    ];
    const result = score(record, [], { docUrlSources: AUTH0_DOC_SOURCES });
    // 34 (valid URL) + 33 (no error) + 17 (no rewrite) + 16 (no L4 graders → 100%) = 100
    expect(getDim(result, 'Docs Quality').rawScore).toBe(100.0);
  });

  it('invalid domain scores 0 on URL signal', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://example.com/some-page' },
      }),
    ];
    const result = score(record, [], { docUrlSources: AUTH0_DOC_SOURCES });
    // 0 (invalid URL) + 33 (no error) + 17 (no rewrite) + 16 (no L4) = 66
    expect(getDim(result, 'Docs Quality').rawScore).toBe(66.0);
  });

  it('errored fetch loses the no-error signal', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: true,
        args: { url: 'https://auth0.com/docs/quickstart' },
      }),
    ];
    const result = score(record, [], { docUrlSources: AUTH0_DOC_SOURCES });
    // 34 (valid URL) + 0 (errored) + 17 (no rewrite) + 16 (no L4) = 67
    expect(getDim(result, 'Docs Quality').rawScore).toBe(67.0);
  });

  it('overwrite after fetch loses the no-rewrite signal', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }),
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://auth0.com/docs/quickstart' },
      }),
      makeToolCall('write_file', 1, { args: { path: 'app.ts' } }), // re-writes a pre-existing path
    ];
    const result = score(record, [], { docUrlSources: AUTH0_DOC_SOURCES });
    // 34 (valid URL) + 33 (no error) + 0 (rewrite detected) + 16 (no L4) = 83
    expect(getDim(result, 'Docs Quality').rawScore).toBe(83.0);
  });

  it('failing L4 graders reduces L4 sub-signal proportionally', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://auth0.com/docs/quickstart' },
      }),
    ];
    const graders: GraderResult[] = [
      { name: 'l4-pass', kind: 'judge', passed: true, detail: '', level: GraderLevel.L4 },
      { name: 'l4-fail', kind: 'judge', passed: false, detail: 'structural issue', level: GraderLevel.L4 },
    ];
    const result = score(record, graders, { docUrlSources: AUTH0_DOC_SOURCES });
    // 34 + 33 + 17 + round(16 * 0.5) = 34 + 33 + 17 + 8 = 92
    expect(getDim(result, 'Docs Quality').rawScore).toBe(92.0);
  });

  it('averages score across multiple doc lookups', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      // Perfect lookup: 34+33+17+16 = 100
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://auth0.com/docs/quickstart' },
      }),
      // Bad lookup: 0+0+17+16 = 33 (wrong domain, errored)
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: true,
        args: { url: 'https://example.com/bad' },
      }),
    ];
    const result = score(record, [], { docUrlSources: AUTH0_DOC_SOURCES });
    // avg(100, 33) = 66.5
    expect(getDim(result, 'Docs Quality').rawScore).toBe(66.5);
  });

  it('WebSearch query string (non-http args.url) is excluded and scores 100', () => {
    // WebSearch normalises args.url to a query string, not a real URL.
    // These should be excluded entirely rather than failing the allowlist.
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'auth0 react quickstart' }, // query string, not http URL
      }),
    ];
    const result = score(record);
    // Non-http lookup is filtered out → no scored lookups → full marks
    expect(getDim(result, 'Docs Quality').rawScore).toBe(100.0);
    expect(getDim(result, 'Docs Quality').notes).toContain('No doc lookups');
  });

  it('host-spoofing URL does not score valid-domain points', () => {
    // e.g. https://auth0.com.evil.com/docs should not match auth0.com
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://auth0.com.evil.com/docs/quickstart' },
      }),
    ];
    const result = score(record, [], { docUrlSources: AUTH0_DOC_SOURCES });
    // 0 (spoofed domain) + 33 (no error) + 17 (no rewrite) + 16 (no L4) = 66
    expect(getDim(result, 'Docs Quality').rawScore).toBe(66.0);
  });
});

// ── docUrlSources option tests ────────────────────────────────────────────────

describe('score - Docs Quality docUrlSources option', () => {
  it('custom docUrlSources replaces defaults — known Auth0 URL no longer scores valid-domain points', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://auth0.com/docs/quickstart' },
      }),
    ];
    const result = score(record, [], { docUrlSources: [['docs.mycompany.com', '/']] });
    // 0 (auth0.com not in custom list) + 33 (no error) + 17 (no rewrite) + 16 (no L4) = 66
    expect(getDim(result, 'Docs Quality').rawScore).toBe(66.0);
  });

  it('custom docUrlSources scores valid-domain points for the supplied domain', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://docs.mycompany.com/sdk' },
      }),
    ];
    const result = score(record, [], { docUrlSources: [['docs.mycompany.com', '/']] });
    // 34 (valid) + 33 (no error) + 17 (no rewrite) + 16 (no L4) = 100
    expect(getDim(result, 'Docs Quality').rawScore).toBe(100.0);
  });

  it('combining Auth0 and custom domains scores both as valid', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://auth0.com/docs/quickstart' },
      }),
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://docs.mycompany.com/sdk' },
      }),
    ];
    const result = score(record, [], {
      docUrlSources: [
        ['auth0.com', '/docs'],
        ['docs.mycompany.com', '/'],
      ],
    });
    // Both lookups: 34+33+17+16 = 100 each → avg 100
    expect(getDim(result, 'Docs Quality').rawScore).toBe(100.0);
  });

  it('empty docUrlSources bypasses domain check — scores full valid-domain points', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = [
      makeToolCall('fetch_url', 1, {
        isDocLookup: true,
        causedError: false,
        args: { url: 'https://auth0.com/docs/quickstart' },
      }),
    ];
    const result = score(record, [], { docUrlSources: [] });
    // 34 (bypassed check) + 33 (no error) + 17 (no rewrite) + 16 (no L4) = 100
    expect(getDim(result, 'Docs Quality').rawScore).toBe(100.0);
  });
});

// ── score() integration tests ─────────────────────────────────────────────────

describe('score - process zero-out gate', () => {
  it('zeroes all 4 process dimensions when toolCalls is empty', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir, toolCalls: [] }), []);
    const processNames = ['Setup Friction', 'Setup Speed', 'Efficiency', 'Error Recovery'];
    for (const name of processNames) {
      expect(getDim(result, name).rawScore).toBe(0);
      expect(getDim(result, name).notes).toContain('Agent did not execute');
    }
  });

  it('preserves output dimensions when toolCalls is empty', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [
      { name: 'a', kind: 'contains', passed: true, detail: '' },
      { name: 'b', kind: 'contains', passed: false, detail: '' },
    ];
    const result = score(makeRecord({ workspace: dir, toolCalls: [] }), graderResults);
    expect(getDim(result, 'Correctness').rawScore).toBe(50);
  });

  it('scores process dimensions normally when toolCalls is non-empty', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), []);
    expect(getDim(result, 'Setup Friction').rawScore).toBe(100);
    expect(getDim(result, 'Efficiency').rawScore).toBe(100);
  });
});

describe('score() integration', () => {
  it('returns 8 dimensions', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), []);
    expect(result.dimensions.length).toBe(8);
  });

  it('overall grade is valid letter', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), []);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.overallGrade);
  });

  it('overall score is in range 0-100', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), []);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('grader pass rate with all passing = 1', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [{ name: 'a', kind: 'contains', passed: true, detail: '' }];
    const result = score(makeRecord({ workspace: dir }), graderResults);
    expect(result.graderPassRate).toBe(1.0);
  });
});

// ── Grader collectFiles exclusion tests ──────────────────────────────────────

describe('collectFiles - skill file exclusion', () => {
  it('excludes .claude/ directory from grading corpus', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    mkdirSync(join(dir, '.claude', 'skills', 'auth0-react'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'auth0-react', 'SKILL.md'), 'loginWithRedirect');

    const files = collectGraderFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths.every((p) => !p.startsWith('.claude/'))).toBe(true);
  });

  it('does not match skill keywords when only present in .claude/skills/', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'index.ts'), 'console.log("hello")');
    mkdirSync(join(dir, '.claude', 'skills', 'auth0-react'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'auth0-react', 'SKILL.md'), 'Auth0Provider useAuth0');

    const files = collectGraderFiles(dir);
    const combined = Object.values(files).join('\n');
    expect(combined).not.toContain('Auth0Provider');
    expect(combined).not.toContain('useAuth0');
  });

  it('excludes .github/ directory from grading corpus', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'settings.json'), 'Auth0Provider useAuth0');

    const files = collectGraderFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths.every((p) => !p.startsWith('.github/'))).toBe(true);
  });

  it('excludes .gemini/ directory from grading corpus', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    mkdirSync(join(dir, '.gemini'), { recursive: true });
    writeFileSync(join(dir, '.gemini', 'settings.json'), 'Auth0Provider useAuth0');

    const files = collectGraderFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths.every((p) => !p.startsWith('.gemini/'))).toBe(true);
  });

  it('excludes node_modules/ directory from grading corpus', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    mkdirSync(join(dir, 'node_modules', 'some-pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'some-pkg', 'index.js'), "password = 'secret'");

    const files = collectGraderFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths.every((p) => !p.startsWith('node_modules/'))).toBe(true);
  });

  it('includes GEMINI.md in grading corpus (no longer generated by skills strategy)', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    writeFileSync(join(dir, 'GEMINI.md'), 'Auth0Provider useAuth0 skill content');

    const files = collectGraderFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths).toContain('GEMINI.md');
  });
});
