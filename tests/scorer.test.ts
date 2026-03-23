/**
 * Happy path tests for src/agent_eval/scorer.ts
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RunRecord, ToolCallRecord } from '../src/agent_eval/agent.js';
import type { GraderResult } from '../src/agent_eval/graders.js';
import { score, scoreToGrade, type ScoredResult, type DimensionScore } from '../src/agent_eval/scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    taskName: 'test-task',
    model: 'test-model',
    sessionId: 'abc12345',
    startTime: 0,
    endTime: 0,
    toolCalls: [],
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

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'scorer_test_'));
}

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
  it('no tool calls = N/A (100)', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Efficiency').rawScore).toBe(100.0);
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

// ── Docs Quality tests ────────────────────────────────────────────────────────

describe('score - Docs Quality', () => {
  it('all features present = 100', () => {
    const dir = tmpDir();
    const features = { llms_txt: true, context7: true, mcp_server: true, typed_sdk: true, openapi_spec: true };
    const result = score(makeRecord({ workspace: dir }), features);
    expect(getDim(result, 'Docs Quality').rawScore).toBe(100.0);
  });

  it('no features = 0', () => {
    const dir = tmpDir();
    const features = { llms_txt: false, context7: false, mcp_server: false, typed_sdk: false, openapi_spec: false };
    const result = score(makeRecord({ workspace: dir }), features);
    expect(getDim(result, 'Docs Quality').rawScore).toBe(0.0);
  });

  it('partial features proportional', () => {
    const dir = tmpDir();
    const features = { llms_txt: true, context7: false, mcp_server: true, typed_sdk: false, openapi_spec: false };
    const result = score(makeRecord({ workspace: dir }), features);
    expect(getDim(result, 'Docs Quality').rawScore).toBe(40.0);
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
    const result = score(makeRecord({ workspace: dir }), undefined, graderResults);
    expect(getDim(result, 'Correctness').rawScore).toBe(100.0);
  });

  it('half passing = 50', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [
      { name: 'a', kind: 'contains', passed: true, detail: '' },
      { name: 'b', kind: 'contains', passed: false, detail: '' },
    ];
    const result = score(makeRecord({ workspace: dir }), undefined, graderResults);
    expect(getDim(result, 'Correctness').rawScore).toBe(50.0);
  });

  it('none passing = 0', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [{ name: 'a', kind: 'contains', passed: false, detail: '' }];
    const result = score(makeRecord({ workspace: dir }), undefined, graderResults);
    expect(getDim(result, 'Correctness').rawScore).toBe(0.0);
  });

  it('empty graders = 0', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), undefined, []);
    expect(getDim(result, 'Correctness').rawScore).toBe(0.0);
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
    writeFileSync(join(dir, 'app.py'), 'from auth0 import Auth0Client\n');
    const result = score(makeRecord({ workspace: dir }));
    const dim = getDim(result, 'Hallucination');
    expect(dim.rawScore).toBeLessThan(100.0);
    expect(dim.notes).toContain('app.py');
  });

  it('detects fake js package', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'app.js'), 'import @auth0/auth0-sdk\n');
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Hallucination').rawScore).toBeLessThan(100.0);
  });

  it('empty workspace = 100', () => {
    const dir = tmpDir();
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
    writeFileSync(join(dir, 'auth.js'), "const client_secret = 'my-super-secret-value';");
    const result = score(makeRecord({ workspace: dir }));
    const dim = getDim(result, 'Security');
    expect(dim.rawScore).toBeLessThan(100.0);
    expect(dim.notes).toContain('auth.js');
  });

  it('detects hardcoded api_key', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'config.js'), "const api_key = 'sk-abc123';");
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Security').rawScore).toBeLessThan(100.0);
  });

  it('empty workspace = 100', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }));
    expect(getDim(result, 'Security').rawScore).toBe(100.0);
  });
});

// ── score() integration tests ─────────────────────────────────────────────────

describe('score() integration', () => {
  it('returns 8 dimensions', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), undefined, []);
    expect(result.dimensions.length).toBe(8);
  });

  it('overall grade is valid letter', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), undefined, []);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.overallGrade);
  });

  it('overall score is in range 0-100', () => {
    const dir = tmpDir();
    const result = score(makeRecord({ workspace: dir }), undefined, []);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('grader pass rate with all passing = 1', () => {
    const dir = tmpDir();
    const graderResults: GraderResult[] = [{ name: 'a', kind: 'contains', passed: true, detail: '' }];
    const result = score(makeRecord({ workspace: dir }), undefined, graderResults);
    expect(result.graderPassRate).toBe(1.0);
  });
});
