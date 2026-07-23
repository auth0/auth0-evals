/**
 * Tests for src/persistence/results.ts
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  resultKey,
  mergeResults,
  loadResults,
  saveResults,
  resolveOutputPath,
  aggregateRuns,
  findDroppedErrors,
} from '../src/persistence/index.js';
import type { AgentJobResult, BaselineJobResult, DimensionSummary, ErrorJobResult } from '@a0/evals-core';
import { makeTmpDir } from './tmp.js';

const tmpDir = makeTmpDir('persistence_test_');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBaseline(overrides: Partial<BaselineJobResult> = {}): BaselineJobResult {
  return {
    eval_id: 'react_quickstart',
    category: 'quickstarts',
    prompt: 'Add Auth0.',
    response_text: '',
    model: 'gpt-5.2',
    mode: 'baseline',
    session_id: 'abc',
    status: 'success',
    grader_pass_rate: 1.0,
    graders_passed: 3,
    graders_total: 3,
    wall_time: 1.0,
    tokens: 100,
    cost_usd: 0.01,
    judge_cost_usd: 0,
    total_cost_usd: 0.01,
    error: '',
    graders: [],
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentJobResult> = {}): AgentJobResult {
  return {
    eval_id: 'react_quickstart',
    category: 'quickstarts',
    prompt: 'Add Auth0.',
    response_text: '',
    model: 'gpt-5.2',
    mode: 'agent',
    tools: ['skills'],
    session_id: 'def',
    status: 'success',
    overall_score: 80,
    overall_grade: 'B',
    grader_pass_rate: 0.9,
    wall_time: 15,
    active_time: 8,
    tool_calls: 10,
    interruptions: 0,
    tokens: 500,
    cost_usd: 0.05,
    judge_cost_usd: 0,
    total_cost_usd: 0.05,
    dimensions: [],
    graders: [],
    session_trace: [],
    turn_metrics: [],
    ...overrides,
  };
}

function makeError(overrides: Partial<ErrorJobResult> = {}): ErrorJobResult {
  return {
    eval_id: 'react_quickstart',
    category: 'quickstarts',
    model: 'gpt-5.2',
    mode: 'agent',
    tools: [],
    status: 'error',
    error: 'something went wrong',
    wall_time: 0,
    tokens: 0,
    cost_usd: 0,
    judge_cost_usd: 0,
    total_cost_usd: 0,
    ...overrides,
  };
}

// ── resultKey ─────────────────────────────────────────────────────────────────

describe('resultKey', () => {
  it('produces eval_id|model|mode|tools format', () => {
    expect(resultKey(makeBaseline())).toBe('react_quickstart|gpt-5.2|baseline|');
  });

  it('baseline result has empty tools segment', () => {
    expect(resultKey(makeBaseline()).endsWith('|')).toBe(true);
  });

  it('agent result includes comma-joined tools', () => {
    expect(resultKey(makeAgent({ tools: ['mcp', 'skills'] }))).toBe('react_quickstart|gpt-5.2|agent|mcp,skills');
  });

  it('error result with no tools has empty tools segment', () => {
    expect(resultKey(makeError({ tools: [] }))).toBe('react_quickstart|gpt-5.2|agent|');
  });

  it('is stable — same input always produces the same key', () => {
    const r = makeBaseline();
    expect(resultKey(r)).toBe(resultKey(r));
  });

  it('differs when eval_id changes', () => {
    expect(resultKey(makeBaseline({ eval_id: 'a' }))).not.toBe(resultKey(makeBaseline({ eval_id: 'b' })));
  });

  it('differs when model changes', () => {
    expect(resultKey(makeBaseline({ model: 'gpt-5.2' }))).not.toBe(
      resultKey(makeBaseline({ model: 'claude-sonnet-4-6' })),
    );
  });

  it('differs when mode changes', () => {
    // same eval + model, different mode
    expect(resultKey(makeBaseline())).not.toBe(resultKey(makeAgent({ tools: [] })));
  });

  it('tool order is normalised — same set in different order produces the same key', () => {
    const ab = resultKey(makeAgent({ tools: ['mcp', 'skills'] }));
    const ba = resultKey(makeAgent({ tools: ['skills', 'mcp'] }));
    expect(ab).toBe(ba);
  });

  it('duplicate tools are deduplicated in the key', () => {
    const deduped = resultKey(makeAgent({ tools: ['skills', 'skills'] }));
    const single = resultKey(makeAgent({ tools: ['skills'] }));
    expect(deduped).toBe(single);
  });

  it('does not throw when tools is null (corrupt on-disk entry)', () => {
    const corrupt = { ...makeAgent(), tools: null } as unknown as AgentJobResult;
    expect(() => resultKey(corrupt)).not.toThrow();
  });

  it('uses empty tools segment when tools is null', () => {
    const corrupt = { ...makeAgent(), tools: null } as unknown as AgentJobResult;
    expect(resultKey(corrupt)).toBe('react_quickstart|gpt-5.2|agent|');
  });

  it('does not throw when tools is a non-array string (corrupt on-disk entry)', () => {
    const corrupt = { ...makeAgent(), tools: 'skills' } as unknown as AgentJobResult;
    expect(() => resultKey(corrupt)).not.toThrow();
  });

  it('uses empty tools segment when tools is a non-array string', () => {
    const corrupt = { ...makeAgent(), tools: 'skills' } as unknown as AgentJobResult;
    expect(resultKey(corrupt)).toBe('react_quickstart|gpt-5.2|agent|');
  });
});

// ── mergeResults ──────────────────────────────────────────────────────────────

describe('mergeResults', () => {
  it('returns all incoming when existing is empty', () => {
    const incoming = [makeBaseline(), makeAgent()];
    expect(mergeResults([], incoming)).toEqual(incoming);
  });

  it('returns empty array when both inputs are empty', () => {
    expect(mergeResults([], [])).toEqual([]);
  });

  it('preserves existing entries not present in incoming', () => {
    const old = makeBaseline({ eval_id: 'nextjs_quickstart' });
    const fresh = makeBaseline({ eval_id: 'react_quickstart' });
    const merged = mergeResults([old], [fresh]);
    expect(merged).toContainEqual(old);
    expect(merged).toContainEqual(fresh);
    expect(merged).toHaveLength(2);
  });

  it('incoming replaces an existing entry with the same key', () => {
    const original = makeBaseline({ grader_pass_rate: 0.5 });
    const updated = makeBaseline({ grader_pass_rate: 1.0 });
    const merged = mergeResults([original], [updated]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(updated);
  });

  it('replaced existing entries do not appear in the output', () => {
    const old = makeBaseline({ tokens: 100 });
    const fresh = makeBaseline({ tokens: 200 });
    const merged = mergeResults([old], [fresh]);
    expect(merged.some((r) => (r as BaselineJobResult).tokens === 100)).toBe(false);
  });

  it('unmatched existing entries are preserved alongside incoming', () => {
    const other = makeBaseline({ model: 'claude-sonnet-4-6' });
    const updated = makeBaseline({ model: 'gpt-5.2' });
    const merged = mergeResults([other, makeBaseline()], [updated]);
    expect(merged).toContainEqual(other);
  });

  it('within incoming, the last entry wins for duplicate keys', () => {
    // Object.fromEntries keeps the last occurrence for a given key.
    const first = makeBaseline({ grader_pass_rate: 0.25 });
    const last = makeBaseline({ grader_pass_rate: 0.75 });
    const merged = mergeResults([], [first, last]);
    expect(merged).toHaveLength(1);
    expect((merged[0] as BaselineJobResult).grader_pass_rate).toBe(0.75);
  });

  it('preserves results for different models as separate entries', () => {
    const a = makeBaseline({ model: 'gpt-5.2' });
    const b = makeBaseline({ model: 'claude-sonnet-4-6' });
    expect(mergeResults([a], [b])).toHaveLength(2);
  });

  it('preserves results for different modes as separate entries', () => {
    const base = makeBaseline();
    const agent = makeAgent({ tools: [] });
    expect(mergeResults([base], [agent])).toHaveLength(2);
  });
});

// ── loadResults ───────────────────────────────────────────────────────────────

describe('loadResults', () => {
  it('returns [] for a non-existent path', () => {
    expect(loadResults('/does/not/exist/scores.json')).toEqual([]);
  });

  it('returns [] for corrupt JSON', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, '{ not valid json', 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('returns [] when the JSON root is an object, not an array', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, JSON.stringify({ eval_id: 'x', model: 'm' }), 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('returns [] for an empty JSON array', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, '[]', 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('filters out entries missing eval_id', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, JSON.stringify([{ model: 'm', mode: 'baseline' }]), 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('filters out entries missing model', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, JSON.stringify([{ eval_id: 'x', mode: 'baseline' }]), 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('filters out entries with missing mode', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, JSON.stringify([{ eval_id: 'x', model: 'm' }]), 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('filters out entries with an invalid mode', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, JSON.stringify([{ eval_id: 'x', model: 'm', mode: 'running' }]), 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('filters out entries where tools is null', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, JSON.stringify([{ eval_id: 'x', model: 'm', mode: 'agent', tools: null }]), 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('filters out entries where tools is a non-array string', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, JSON.stringify([{ eval_id: 'x', model: 'm', mode: 'agent', tools: 'skills' }]), 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('filters out entries where tools contains non-string elements', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    writeFileSync(path, JSON.stringify([{ eval_id: 'x', model: 'm', mode: 'agent', tools: [1, 2] }]), 'utf-8');
    expect(loadResults(path)).toEqual([]);
  });

  it('accepts entries without a tools field (baseline results)', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    const valid = makeBaseline();
    writeFileSync(path, JSON.stringify([valid]), 'utf-8');
    expect(loadResults(path)).toEqual([valid]);
  });

  it('filters out null entries', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    const valid = makeBaseline();
    writeFileSync(path, JSON.stringify([null, valid]), 'utf-8');
    expect(loadResults(path)).toHaveLength(1);
  });

  it('returns only valid entries from a mixed array', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    const valid = makeBaseline();
    writeFileSync(path, JSON.stringify([{ mode: 'baseline' }, valid, null]), 'utf-8');
    const results = loadResults(path);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(valid);
  });

  it('returns all entries from a well-formed file', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    const results = [makeBaseline(), makeAgent()];
    writeFileSync(path, JSON.stringify(results), 'utf-8');
    expect(loadResults(path)).toEqual(results);
  });
});

// ── saveResults / loadResults round-trip ─────────────────────────────────────

describe('saveResults + loadResults round-trip', () => {
  it('reloads what was saved', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    const results = [makeBaseline(), makeAgent(), makeError()];
    saveResults(path, results);
    expect(loadResults(path)).toEqual(results);
  });

  it('writes pretty-printed JSON (2-space indent)', () => {
    const dir = tmpDir();
    const path = join(dir, 'scores.json');
    saveResults(path, [makeBaseline()]);
    const raw = readFileSync(path, 'utf-8');
    expect(raw).toMatch(/^\[\n {2}\{/);
  });
});

// ── resolveOutputPath ─────────────────────────────────────────────────────────

describe('resolveOutputPath', () => {
  it('single mode produces scores-<mode>.json', () => {
    expect(resolveOutputPath('/root', ['baseline'])).toBe('/root/scores-baseline.json');
  });

  it('single agent mode produces scores-agent.json', () => {
    expect(resolveOutputPath('/root', ['agent'])).toBe('/root/scores-agent.json');
  });

  it('multiple modes produces scores-all-modes.json', () => {
    expect(resolveOutputPath('/root', ['baseline', 'agent'])).toBe('/root/scores-all-modes.json');
  });

  it('override takes precedence over the derived name for a single mode', () => {
    expect(resolveOutputPath('/root', ['baseline'], 'custom.json')).toBe('/root/custom.json');
  });

  it('override takes precedence over the derived name for multiple modes', () => {
    expect(resolveOutputPath('/root', ['baseline', 'agent'], 'out.json')).toBe('/root/out.json');
  });

  it('result is always joined with frameworkRoot', () => {
    expect(resolveOutputPath('/my/project', ['agent'])).toBe('/my/project/scores-agent.json');
  });

  it('throws for an absolute override path', () => {
    expect(() => resolveOutputPath('/root', ['baseline'], '/tmp/out.json')).toThrow();
  });

  it('throws for a ../ traversal override', () => {
    expect(() => resolveOutputPath('/root', ['baseline'], '../evil.json')).toThrow();
  });

  it('throws for a deeply nested traversal that escapes root', () => {
    expect(() => resolveOutputPath('/root/sub', ['baseline'], '../../etc/passwd')).toThrow();
  });

  it('accepts a valid relative subdirectory override', () => {
    expect(resolveOutputPath('/root', ['baseline'], 'out/scores.json')).toBe('/root/out/scores.json');
  });
});

// ── aggregateRuns ─────────────────────────────────────────────────────────────

function makeDimension(overrides: Partial<DimensionSummary> = {}): DimensionSummary {
  return { name: 'Correctness', score: 80, grade: 'B', weight: 0.25, weighted: 20, ...overrides };
}

describe('aggregateRuns', () => {
  it('passes a single result through unchanged', () => {
    const r = makeBaseline();
    expect(aggregateRuns([r])).toEqual([r]);
  });

  it('returns an empty array for empty input', () => {
    expect(aggregateRuns([])).toEqual([]);
  });

  it('sets run_count to the number of runs', () => {
    const runs = [makeBaseline({ grader_pass_rate: 0.6 }), makeBaseline({ grader_pass_rate: 0.8 })];
    const [result] = aggregateRuns(runs) as BaselineJobResult[];
    expect(result.run_count).toBe(2);
  });

  it('embeds raw runs in the runs[] field', () => {
    const runs = [makeBaseline({ grader_pass_rate: 0.6 }), makeBaseline({ grader_pass_rate: 0.8 })];
    const [result] = aggregateRuns(runs) as BaselineJobResult[];
    expect(result.runs).toHaveLength(2);
  });

  // ── Baseline aggregation ───────────────────────────────────────────────────

  it('derives grader_pass_rate from median graders_passed for two runs', () => {
    // graders_passed median = (3+4)/2 = 3.5 → rounds to 4; rate = 4/5 = 0.8
    const runs = [
      makeBaseline({ graders_passed: 3, graders_total: 5, grader_pass_rate: 0.6 }),
      makeBaseline({ graders_passed: 4, graders_total: 5, grader_pass_rate: 0.8 }),
    ];
    const [result] = aggregateRuns(runs) as BaselineJobResult[];
    expect(result.graders_passed).toBe(4);
    expect(result.grader_pass_rate).toBeCloseTo(0.8);
  });

  it('grader_pass_rate and graders_passed are consistent after aggregation', () => {
    const runs = [
      makeBaseline({ graders_passed: 3, graders_total: 5, grader_pass_rate: 0.6 }),
      makeBaseline({ graders_passed: 4, graders_total: 5, grader_pass_rate: 0.8 }),
    ];
    const [result] = aggregateRuns(runs) as BaselineJobResult[];
    expect(result.grader_pass_rate).toBeCloseTo(result.graders_passed / result.graders_total);
  });

  it('uses the exact middle graders_passed for an odd number of baseline runs', () => {
    // median graders_passed = 3; rate = 3/4 = 0.75
    const runs = [
      makeBaseline({ graders_passed: 2, graders_total: 4, grader_pass_rate: 0.5 }),
      makeBaseline({ graders_passed: 3, graders_total: 4, grader_pass_rate: 0.75 }),
      makeBaseline({ graders_passed: 4, graders_total: 4, grader_pass_rate: 1.0 }),
    ];
    const [result] = aggregateRuns(runs) as BaselineJobResult[];
    expect(result.graders_passed).toBe(3);
    expect(result.grader_pass_rate).toBeCloseTo(0.75);
  });

  it('sums cost_usd across baseline runs', () => {
    const runs = [makeBaseline({ cost_usd: 0.01 }), makeBaseline({ cost_usd: 0.02 })];
    const [result] = aggregateRuns(runs) as BaselineJobResult[];
    expect(result.cost_usd).toBeCloseTo(0.03);
  });

  it('sums tokens across baseline runs', () => {
    const runs = [makeBaseline({ tokens: 100 }), makeBaseline({ tokens: 200 })];
    const [result] = aggregateRuns(runs) as BaselineJobResult[];
    expect(result.tokens).toBe(300);
  });

  // ── Agent aggregation ──────────────────────────────────────────────────────

  it('uses median overall_score for two agent runs', () => {
    const runs = [makeAgent({ overall_score: 60 }), makeAgent({ overall_score: 80 })];
    const [result] = aggregateRuns(runs) as AgentJobResult[];
    expect(result.overall_score).toBeCloseTo(70);
  });

  it('uses the exact middle overall_score for three agent runs', () => {
    const runs = [makeAgent({ overall_score: 50 }), makeAgent({ overall_score: 70 }), makeAgent({ overall_score: 90 })];
    const [result] = aggregateRuns(runs) as AgentJobResult[];
    expect(result.overall_score).toBeCloseTo(70);
  });

  it('derives overall_grade from the median overall_score', () => {
    // median is 92 → grade A
    const runs = [makeAgent({ overall_score: 88 }), makeAgent({ overall_score: 92 }), makeAgent({ overall_score: 96 })];
    const [result] = aggregateRuns(runs) as AgentJobResult[];
    expect(result.overall_grade).toBe('A');
  });

  it('medians per-dimension scores', () => {
    const dim = (score: number) => makeDimension({ score, weighted: score * 0.25 });
    const runs = [
      makeAgent({ overall_score: 60, dimensions: [dim(60)] }),
      makeAgent({ overall_score: 80, dimensions: [dim(80)] }),
    ];
    const [result] = aggregateRuns(runs) as AgentJobResult[];
    expect(result.dimensions[0]?.score).toBeCloseTo(70);
  });

  it('sums cost_usd across agent runs', () => {
    const runs = [makeAgent({ cost_usd: 0.05 }), makeAgent({ cost_usd: 0.1 })];
    const [result] = aggregateRuns(runs) as AgentJobResult[];
    expect(result.cost_usd).toBeCloseTo(0.15);
  });

  it('sums tokens across agent runs', () => {
    const runs = [makeAgent({ tokens: 500 }), makeAgent({ tokens: 1000 })];
    const [result] = aggregateRuns(runs) as AgentJobResult[];
    expect(result.tokens).toBe(1500);
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('drops error results when at least one run succeeded', () => {
    const ok = makeAgent({ overall_score: 70 });
    const err = makeError();
    const [result] = aggregateRuns([ok, err]) as AgentJobResult[];
    expect(result.status).toBe('success');
  });

  it('sets run_count and runs on partial failure (1 success + 1 error)', () => {
    // When 2 runs are requested but 1 errors, run_count reflects the successful
    // runs count (1), and runs contains only the successful result.
    const ok = makeAgent({ overall_score: 70, tools: [] });
    const err = makeError();
    const [result] = aggregateRuns([ok, err]) as AgentJobResult[];
    expect(result.run_count).toBe(1);
    expect(result.runs).toHaveLength(1);
    expect(result.runs![0]!.status).toBe('success');
  });

  it('keeps the last error result when all runs in a group errored', () => {
    const err1 = makeError({ error: 'first' });
    const err2 = makeError({ error: 'second' });
    const [result] = aggregateRuns([err1, err2]);
    expect(result.status).toBe('error');
    expect((result as ErrorJobResult).error).toBe('second');
  });

  // ── Multiple keys ──────────────────────────────────────────────────────────

  it('aggregates different keys independently', () => {
    // graders_passed medians: react → (6+8)/2=7 → 7/10=0.7; next → (5+9)/2=7 → 7/10=0.7
    const reactRuns = [
      makeBaseline({ eval_id: 'react_quickstart', graders_passed: 6, graders_total: 10, grader_pass_rate: 0.6 }),
      makeBaseline({ eval_id: 'react_quickstart', graders_passed: 8, graders_total: 10, grader_pass_rate: 0.8 }),
    ];
    const nextRuns = [
      makeBaseline({ eval_id: 'nextjs_quickstart', graders_passed: 5, graders_total: 10, grader_pass_rate: 0.5 }),
      makeBaseline({ eval_id: 'nextjs_quickstart', graders_passed: 9, graders_total: 10, grader_pass_rate: 0.9 }),
    ];
    const results = aggregateRuns([...reactRuns, ...nextRuns]) as BaselineJobResult[];
    expect(results).toHaveLength(2);
    const react = results.find((r) => r.eval_id === 'react_quickstart')!;
    const next = results.find((r) => r.eval_id === 'nextjs_quickstart')!;
    expect(react.grader_pass_rate).toBeCloseTo(0.7);
    expect(next.grader_pass_rate).toBeCloseTo(0.7);
  });
});

// ── findDroppedErrors ─────────────────────────────────────────────────────────

describe('findDroppedErrors', () => {
  it('returns an empty array when there are no errors', () => {
    expect(findDroppedErrors([makeBaseline(), makeBaseline()])).toEqual([]);
  });

  it('returns an empty array when all runs errored (nothing is dropped)', () => {
    expect(findDroppedErrors([makeError(), makeError()])).toEqual([]);
  });

  it('returns the error when its job key also has a successful run', () => {
    // makeError defaults to mode: agent, tools: [] — makeAgent must match
    const ok = makeAgent({ tools: [] });
    const err = makeError();
    const result = findDroppedErrors([ok, err]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(err);
  });

  it('returns multiple errors when several runs for the same job failed', () => {
    const ok = makeAgent({ tools: [] });
    const err1 = makeError({ error: 'first' });
    const err2 = makeError({ error: 'second' });
    expect(findDroppedErrors([ok, err1, err2])).toHaveLength(2);
  });

  it('does not return errors from an all-error group', () => {
    const okGroup = makeAgent({ eval_id: 'react_quickstart', tools: [] });
    const droppedErr = makeError({ eval_id: 'react_quickstart' });
    const allErrGroup = makeError({ eval_id: 'nextjs_quickstart' });
    const result = findDroppedErrors([okGroup, droppedErr, allErrGroup]);
    expect(result).toHaveLength(1);
    expect(result[0]?.eval_id).toBe('react_quickstart');
  });
});
