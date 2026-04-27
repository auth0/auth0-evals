/**
 * Tests for src/reporters/braintrust.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { experimentName, mapResult } from '../src/reporters/braintrust.js';
import type { AgentJobResult, BaselineJobResult, ErrorJobResult } from '@a0/eval';

// ── experimentName ───────────────────────────────────────────────────────────

describe('experimentName', () => {
  it('includes mode in the name', () => {
    const name = experimentName('baseline', []);
    expect(name).toMatch(/^baseline-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it('includes tools when provided', () => {
    const name = experimentName('agent', ['Skills']);
    expect(name).toMatch(/^agent-Skills-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it('joins multiple tools with +', () => {
    const name = experimentName('agent', ['Skills', 'MCP']);
    expect(name).toContain('-Skills+MCP-');
  });
});

// ── mapResult ────────────────────────────────────────────────────────────────

describe('mapResult', () => {
  function makeBaselineResult(): BaselineJobResult {
    return {
      eval_id: 'react_quickstart',
      category: 'quickstarts',
      prompt: 'Add Auth0 login to the React app.',
      response_text: 'Here is the code with Auth0...',
      model: 'gpt-5.2',
      mode: 'baseline',
      session_id: 'sess-123',
      status: 'success',
      grader_pass_rate: 0.75,
      graders_passed: 6,
      graders_total: 8,
      wall_time: 3.2,
      tokens: 1500,
      cost_usd: 0.015,
      error: '',
      graders: [
        { name: 'contains_auth0_react', kind: 'contains', passed: true, detail: '' },
        { name: 'no_deprecated_loading', kind: 'notContains', passed: false, detail: '' },
      ],
    };
  }

  function makeAgentResult(): AgentJobResult {
    return {
      eval_id: 'nextjs_quickstart',
      category: 'quickstarts',
      prompt: 'Add Auth0 login to the Next.js app.',
      response_text: 'Auth0 integration complete.',
      model: 'claude-sonnet-4-6',
      mode: 'agent',
      tools: ['Skills'],
      session_id: 'sess-456',
      status: 'success',
      overall_score: 82,
      overall_grade: 'B',
      grader_pass_rate: 0.9,
      wall_time: 15,
      active_time: 8,
      tool_calls: 12,
      interruptions: 1,
      tokens: 5000,
      cost_usd: 0.05,
      dimensions: [
        { name: 'Correctness', score: 90, grade: 'A', weight: 0.25, weighted: 22.5 },
        { name: 'Hallucination', score: 70, grade: 'C', weight: 0.15, weighted: 10.5 },
      ],
      graders: [{ name: 'contains_nextjs_auth0', kind: 'contains', passed: true, detail: '' }],
      session_trace: [],
      turn_metrics: [],
    };
  }

  function makeErrorResult(overrides: Partial<ErrorJobResult> = {}): ErrorJobResult {
    return {
      eval_id: 'test',
      model: 'gpt-5.2',
      mode: 'baseline',
      tools: [],
      category: '',
      status: 'error',
      error: '',
      wall_time: 0,
      tokens: 0,
      cost_usd: 0,
      ...overrides,
    };
  }

  // ── spanAttributes (row name) ──

  it('sets span name to eval_id / model', () => {
    const { spanAttributes } = mapResult(makeBaselineResult());
    expect(spanAttributes.name).toBe('react_quickstart / gpt-5.2');
    expect(spanAttributes.type).toBe('eval');
  });

  // ── input/output (strings) ──

  it('input is the prompt string', () => {
    expect(mapResult(makeBaselineResult()).input).toBe('Add Auth0 login to the React app.');
  });

  it('output is the response string', () => {
    expect(mapResult(makeBaselineResult()).output).toBe('Here is the code with Auth0...');
  });

  it('defaults to empty strings for error results (no prompt/response_text)', () => {
    const r = mapResult(makeErrorResult({ eval_id: 'x', model: 'm' }));
    expect(r.input).toBe('');
    expect(r.output).toBe('');
  });

  // ── scores (universal only — no per-grader columns) ──

  it('includes grader_pass_rate in scores', () => {
    expect(mapResult(makeBaselineResult()).scores['grader_pass_rate']).toBe(0.75);
  });

  it('includes overall_score normalized to 0-1 for agent mode', () => {
    expect(mapResult(makeAgentResult()).scores['overall_score']).toBe(0.82);
  });

  it('does NOT include per-grader scores (avoids sparse columns)', () => {
    const { scores } = mapResult(makeBaselineResult());
    const graderKeys = Object.keys(scores).filter((k) => k.startsWith('grader/'));
    expect(graderKeys).toHaveLength(0);
  });

  it('does NOT include per-dimension scores in scores', () => {
    const { scores } = mapResult(makeAgentResult());
    const dimKeys = Object.keys(scores).filter((k) => k.startsWith('dimension/'));
    expect(dimKeys).toHaveLength(0);
  });

  it('produces no scores for error results (no grader_pass_rate or overall_score)', () => {
    const { scores } = mapResult(makeErrorResult({ model: 'm' }));
    expect(Object.keys(scores)).toHaveLength(0);
  });

  // ── metrics ──

  it('includes duration_ms in metrics', () => {
    expect(mapResult(makeBaselineResult()).metrics['duration_ms']).toBe(3200);
  });

  it('includes total_tokens and cost_usd in metrics', () => {
    const { metrics } = mapResult(makeBaselineResult());
    expect(metrics['total_tokens']).toBe(1500);
    expect(metrics['cost_usd']).toBe(0.015);
  });

  it('includes agent-specific metrics', () => {
    const { metrics } = mapResult(makeAgentResult());
    expect(metrics['active_time_ms']).toBe(8000);
    expect(metrics['tool_calls']).toBe(12);
    expect(metrics['interruptions']).toBe(1);
  });

  it('omits undefined metrics', () => {
    const { metrics } = mapResult(makeBaselineResult());
    expect(metrics).not.toHaveProperty('active_time_ms');
    expect(metrics).not.toHaveProperty('tool_calls');
  });

  // ── metadata (includes per-grader detail for drill-down) ──

  it('includes model and mode in metadata', () => {
    const { metadata } = mapResult(makeBaselineResult());
    expect(metadata.model).toBe('gpt-5.2');
    expect(metadata.mode).toBe('baseline');
  });

  it('includes per-grader breakdown in metadata', () => {
    const { metadata } = mapResult(makeBaselineResult());
    const graders = metadata.graders as { name: string; passed: boolean }[];
    expect(graders).toHaveLength(2);
    expect(graders[0]).toEqual({ name: 'contains_auth0_react', kind: 'contains', passed: true });
    expect(graders[1]).toEqual({ name: 'no_deprecated_loading', kind: 'notContains', passed: false });
  });

  it('includes per-dimension breakdown in metadata', () => {
    const { metadata } = mapResult(makeAgentResult());
    const dims = metadata.dimensions as { name: string; score: number }[];
    expect(dims).toHaveLength(2);
    expect(dims[0].name).toBe('Correctness');
    expect(dims[0].score).toBe(90);
  });

  // ── tags ──

  it('includes mode and category as tags', () => {
    const { tags } = mapResult(makeBaselineResult());
    expect(tags).toContain('baseline');
    expect(tags).toContain('quickstarts');
  });

  it('includes tools in tags for agent mode', () => {
    const { tags } = mapResult(makeAgentResult());
    expect(tags).toContain('agent');
    expect(tags).toContain('Skills');
  });
});

// ── createBraintrustReporter ─────────────────────────────────────────────────

describe('createBraintrustReporter', () => {
  const TEST_PROJECT_ID = 'test-project-id';
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.BRAINTRUST_API_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    if (savedKey !== undefined) process.env.BRAINTRUST_API_KEY = savedKey;
    else delete process.env.BRAINTRUST_API_KEY;
  });

  it('returns null when BRAINTRUST_API_KEY is not set', async () => {
    delete process.env.BRAINTRUST_API_KEY;
    const { createBraintrustReporter } = await import('../src/reporters/braintrust.js');
    const reporter = await createBraintrustReporter('baseline', [], { projectId: TEST_PROJECT_ID });
    expect(reporter).toBeNull();
  });

  it('creates a reporter when API key is set', async () => {
    process.env.BRAINTRUST_API_KEY = 'test-key';
    const tracedSpy = vi.fn((cb: (span: { log: typeof vi.fn }) => void) => cb({ log: vi.fn() }));
    vi.doMock('braintrust', () => ({
      init: vi.fn().mockReturnValue({
        traced: tracedSpy,
        summarize: vi.fn().mockResolvedValue({ experimentUrl: 'https://example.com' }),
      }),
    }));
    const { createBraintrustReporter } = await import('../src/reporters/braintrust.js');
    const reporter = await createBraintrustReporter('baseline', [], { projectId: TEST_PROJECT_ID });
    expect(reporter).not.toBeNull();
  });

  it('log() calls experiment.traced() with span name and type', async () => {
    process.env.BRAINTRUST_API_KEY = 'test-key';
    const spanLog = vi.fn();
    const tracedSpy = vi.fn((cb: (span: { log: typeof vi.fn }) => void) => cb({ log: spanLog }));
    vi.doMock('braintrust', () => ({
      init: vi.fn().mockReturnValue({
        traced: tracedSpy,
        summarize: vi.fn().mockResolvedValue({ experimentUrl: 'https://example.com' }),
      }),
    }));
    const { createBraintrustReporter } = await import('../src/reporters/braintrust.js');
    const reporter = await createBraintrustReporter('baseline', [], { projectId: TEST_PROJECT_ID });
    const errResult: ErrorJobResult = {
      eval_id: 'test',
      model: 'gpt-5.2',
      mode: 'baseline',
      tools: [],
      category: '',
      status: 'error',
      error: '',
      wall_time: 0,
      tokens: 0,
      cost_usd: 0,
    };
    reporter!.log(errResult);
    expect(tracedSpy).toHaveBeenCalledWith(expect.any(Function), {
      name: 'test / gpt-5.2',
      type: 'eval',
    });
    expect(spanLog).toHaveBeenCalledWith(
      expect.objectContaining({ input: '', output: '', scores: {}, tags: ['baseline'] }),
    );
  });

  it('returns null when init throws', async () => {
    process.env.BRAINTRUST_API_KEY = 'bad-key';
    vi.doMock('braintrust', () => ({
      init: vi.fn().mockImplementation(() => {
        throw new Error('auth failed');
      }),
    }));
    const { createBraintrustReporter } = await import('../src/reporters/braintrust.js');
    const reporter = await createBraintrustReporter('baseline', [], { projectId: TEST_PROJECT_ID });
    expect(reporter).toBeNull();
  });
});
