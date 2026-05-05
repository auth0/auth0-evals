/**
 * Happy path tests for src/agent_eval/scorer.ts
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import type { RunRecord, ToolCallRecord } from '@a0/eval';
import { GraderLevel, type GraderResult } from '@a0/eval-graders';
import { collectGraderFiles as collectFiles } from '@a0/eval';
import { score, scoreToGrade, type ScoredResult, type DimensionScore } from '@a0/eval';

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

  it('at ideal call count = 100', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = Array.from({ length: 10 }, () => makeToolCall());
    const result = score(record);
    expect(getDim(result, 'Efficiency').rawScore).toBe(100.0);
  });

  it('degrades above ideal', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = Array.from({ length: 20 }, () => makeToolCall());
    const result = score(record);
    expect(getDim(result, 'Efficiency').rawScore).toBeLessThan(100.0);
  });

  it('notes include tool summary', () => {
    const dir = tmpDir();
    const record = makeRecord({ workspace: dir });
    record.toolCalls = Array.from({ length: 3 }, () => makeToolCall('read_file'));
    const result = score(record);
    expect(getDim(result, 'Efficiency').notes).toContain('Read');
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
  it('returns 7 dimensions', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), []);
    expect(result.dimensions.length).toBe(7);
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

    const files = collectFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths.every((p) => !p.startsWith('.claude/'))).toBe(true);
  });

  it('does not match skill keywords when only present in .claude/skills/', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'index.ts'), 'console.log("hello")');
    mkdirSync(join(dir, '.claude', 'skills', 'auth0-react'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'auth0-react', 'SKILL.md'), 'Auth0Provider useAuth0');

    const files = collectFiles(dir);
    const combined = Object.values(files).join('\n');
    expect(combined).not.toContain('Auth0Provider');
    expect(combined).not.toContain('useAuth0');
  });

  it('excludes .github/ directory from grading corpus', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'settings.json'), 'Auth0Provider useAuth0');

    const files = collectFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths.every((p) => !p.startsWith('.github/'))).toBe(true);
  });

  it('excludes .gemini/ directory from grading corpus', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    mkdirSync(join(dir, '.gemini'), { recursive: true });
    writeFileSync(join(dir, '.gemini', 'settings.json'), 'Auth0Provider useAuth0');

    const files = collectFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths.every((p) => !p.startsWith('.gemini/'))).toBe(true);
  });

  it('excludes node_modules/ directory from grading corpus', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    mkdirSync(join(dir, 'node_modules', 'some-pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'some-pkg', 'index.js'), "password = 'secret'");

    const files = collectFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths.every((p) => !p.startsWith('node_modules/'))).toBe(true);
  });

  it('includes GEMINI.md in grading corpus (no longer generated by skills strategy)', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.ts'), 'import { Auth0Provider } from "@auth0/auth0-react"');
    writeFileSync(join(dir, 'GEMINI.md'), 'Auth0Provider useAuth0 skill content');

    const files = collectFiles(dir);
    const paths = Object.keys(files);
    expect(paths).toContain('app.ts');
    expect(paths).toContain('GEMINI.md');
  });
});
