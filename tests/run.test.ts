/**
 * Unit tests for buildJobList in run.ts.
 *
 * buildJobList is pure routing logic — it maps (registry, models, modes, tools, agentType)
 * to a flat list of jobs. No subprocess, no filesystem, no mocking required.
 */

import { describe, it, expect } from 'vitest';
import { buildJobList } from '../src/run.js';
import type { EvalConfig } from '../src/config/evaluations.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvalCfg(id = 'test_eval'): EvalConfig {
  return { id, category: 'quickstarts', path: `/tmp/${id}` } as EvalConfig;
}

const EVAL = makeEvalCfg('test_eval');

// ── baseline mode ─────────────────────────────────────────────────────────────

describe('buildJobList — baseline mode', () => {
  it('creates one job per model', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2', 'claude-4-6-sonnet'], ['baseline'], [], undefined);
    expect(jobs).toHaveLength(2);
    expect(jobs[0][1]).toBe('gpt-5.2');
    expect(jobs[1][1]).toBe('claude-4-6-sonnet');
  });

  it('baseline jobs always have empty tools', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline'], ['skills'], undefined);
    expect(jobs[0][3]).toEqual([]);
  });

  it('baseline jobs use DEFAULT_AGENT_TYPE as agentType placeholder', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline'], [], undefined);
    expect(jobs[0][4]).toBe('auth0-ReAct-agent');
  });

  it('baseline jobs use the explicitly provided agentType', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline'], [], 'claude-code');
    expect(jobs[0][4]).toBe('claude-code');
  });
});

// ── agent mode — auto-routing ─────────────────────────────────────────────────

describe('buildJobList — agent mode auto-routing', () => {
  it('claude- model with no explicit agent type → routes to claude-code', () => {
    const jobs = buildJobList([EVAL], ['claude-4-6-sonnet'], ['agent'], [], undefined);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('claude-code');
    expect(jobs[0][1]).toBe('claude-4-6-sonnet');
  });

  it('non-claude model with no explicit agent type → routes to auth0-ReAct-agent', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], [], undefined);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('auth0-ReAct-agent');
    expect(jobs[0][1]).toBe('gpt-5.2');
  });

  it('explicit --agent-type auth0-ReAct-agent with claude model → respects explicit type', () => {
    const jobs = buildJobList([EVAL], ['claude-4-6-sonnet'], ['agent'], [], 'auth0-ReAct-agent');
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('auth0-ReAct-agent');
  });

  it('explicit --agent-type claude-code with non-claude model → sentinel job', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], [], 'claude-code');
    expect(jobs).toHaveLength(1);
    expect(jobs[0][1]).toBe('claude-code'); // model sentinel, not gpt-5.2
    expect(jobs[0][4]).toBe('claude-code');
  });

  it('explicit --agent-type claude-code with non-claude model deduplicates across models', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2', 'gpt-4'], ['agent'], [], 'claude-code');
    // Both models would produce the same claude-code sentinel job — only one should be emitted
    expect(jobs).toHaveLength(1);
    expect(jobs[0][1]).toBe('claude-code');
  });

  it('explicit --agent-type claude-code with non-claude model does not deduplicate across evals', () => {
    const eval2 = makeEvalCfg('another_eval');
    const jobs = buildJobList([EVAL, eval2], ['gpt-5.2'], ['agent'], [], 'claude-code');
    expect(jobs).toHaveLength(2);
    expect(jobs[0][0].id).toBe('test_eval');
    expect(jobs[1][0].id).toBe('another_eval');
  });
});

// ── tools propagation ─────────────────────────────────────────────────────────

describe('buildJobList — tools propagation', () => {
  it('agent jobs receive the tools array', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], ['skills', 'mcp'], undefined);
    expect(jobs[0][3]).toEqual(['skills', 'mcp']);
  });

  it('baseline jobs do not receive tools even when tools are passed', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline'], ['skills'], undefined);
    expect(jobs[0][3]).toEqual([]);
  });
});

// ── mixed modes ───────────────────────────────────────────────────────────────

describe('buildJobList — mixed modes', () => {
  it('both baseline and agent → two jobs per model', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline', 'agent'], [], undefined);
    expect(jobs).toHaveLength(2);
    const modes = jobs.map((j) => j[2]);
    expect(modes).toContain('baseline');
    expect(modes).toContain('agent');
  });

  it('multiple evals × multiple models × both modes → correct job count', () => {
    const eval2 = makeEvalCfg('eval_2');
    const jobs = buildJobList([EVAL, eval2], ['gpt-5.2', 'gpt-4o'], ['baseline', 'agent'], [], undefined);
    // 2 evals × 2 models × 2 modes = 8 jobs
    expect(jobs).toHaveLength(8);
  });
});
