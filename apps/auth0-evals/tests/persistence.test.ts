/**
 * Tests for src/persistence/results.ts
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { resultKey, mergeResults, loadResults, saveResults, resolveOutputPath } from '../src/persistence/results.js';
import type { AgentJobResult, BaselineJobResult, ErrorJobResult } from '../src/types/results.js';
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
