/**
 * Unit tests for buildJobList and buildSubprocessArgs in cli/run.ts.
 *
 * buildJobList is pure routing logic — it maps (registry, models, modes, tools, agentType)
 * to a flat list of jobs. No subprocess, no filesystem, no mocking required.
 */

import { describe, it, expect } from 'vitest';
import { buildJobList, buildSubprocessArgs } from '../src/cli/run.js';
import { MATRIX_TOOL_SETS } from '../src/cli/constants.js';
import type { EvalConfig } from '@a0/eval-core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvalCfg(id = 'test_eval'): EvalConfig {
  return { id, category: 'quickstarts', path: `/tmp/${id}` } as EvalConfig;
}

const EVAL = makeEvalCfg('test_eval');

// ── baseline mode ─────────────────────────────────────────────────────────────

describe('buildJobList — baseline mode', () => {
  it('creates one job per model', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2', 'claude-sonnet-4-6'], ['baseline'], [], undefined);
    expect(jobs).toHaveLength(2);
    expect(jobs[0][1]).toBe('gpt-5.2');
    expect(jobs[1][1]).toBe('claude-sonnet-4-6');
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
    const jobs = buildJobList([EVAL], ['claude-sonnet-4-6'], ['agent'], [], undefined);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('claude-code');
    expect(jobs[0][1]).toBe('claude-sonnet-4-6');
  });

  it('gpt- model with no explicit agent type → routes to copilot', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], [], undefined);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('copilot');
    expect(jobs[0][1]).toBe('gpt-5.2');
  });

  it('non-claude non-gemini non-gpt model with no explicit agent type → routes to auth0-ReAct-agent', () => {
    const jobs = buildJobList([EVAL], ['some-other-model'], ['agent'], [], undefined);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('auth0-ReAct-agent');
    expect(jobs[0][1]).toBe('some-other-model');
  });

  it('explicit --agent-type auth0-ReAct-agent with claude model → respects explicit type', () => {
    const jobs = buildJobList([EVAL], ['claude-sonnet-4-6'], ['agent'], [], 'auth0-ReAct-agent');
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

// ── matrix mode ───────────────────────────────────────────────────────────────

describe('buildJobList — matrix mode', () => {
  it('produces one baseline + two agent jobs for a single model', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline', 'agent'], [], undefined, true);
    // 1 baseline + 2 agent tool-sets (skills, mcp+skills) = 3 jobs
    expect(jobs).toHaveLength(3);
    const baseline = jobs.filter((j) => j[2] === 'baseline');
    const agent = jobs.filter((j) => j[2] === 'agent');
    expect(baseline).toHaveLength(1);
    expect(agent).toHaveLength(2);
  });

  it('baseline jobs in matrix mode always have empty tools', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline', 'agent'], [], undefined, true);
    for (const job of jobs.filter((j) => j[2] === 'baseline')) {
      expect(job[3]).toEqual([]);
    }
  });

  it('agent jobs in matrix mode cover every MATRIX_TOOL_SETS combination', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], [], undefined, true);
    const toolSets = jobs.map((j) => j[3]);
    expect(toolSets).toEqual(MATRIX_TOOL_SETS);
  });

  it('scales correctly across multiple models', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2', 'gpt-4o'], ['baseline', 'agent'], [], undefined, true);
    // 2 models × (1 baseline + 2 agent) = 6 jobs
    expect(jobs).toHaveLength(6);
  });

  it('scales correctly across multiple evals', () => {
    const eval2 = makeEvalCfg('eval_2');
    const jobs = buildJobList([EVAL, eval2], ['gpt-5.2'], ['baseline', 'agent'], [], undefined, true);
    // 2 evals × (1 baseline + 2 agent) = 6 jobs
    expect(jobs).toHaveLength(6);
  });

  it('claude-code deduplication is per-eval per-tool-set, not per-eval only', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2', 'gpt-4o'], ['agent'], [], 'claude-code', true);
    // 2 tool-sets × 1 eval = 2 sentinel jobs (not 1 or 4)
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job[1]).toBe('claude-code');
      expect(job[4]).toBe('claude-code');
    }
  });

  it('matrix=false preserves existing single-tools behaviour', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], ['skills'], undefined, false);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][3]).toEqual(['skills']);
  });

  it('explicit tools override matrix tool-set expansion', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], ['skills'], undefined, true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][3]).toEqual(['skills']);
  });

  it('explicit tools override matrix for baseline+agent', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline', 'agent'], ['mcp', 'skills'], undefined, true);
    // 1 baseline + 1 agent (with explicit tools) = 2 jobs
    expect(jobs).toHaveLength(2);
    const agent = jobs.filter((j) => j[2] === 'agent');
    expect(agent).toHaveLength(1);
    expect(agent[0][3]).toEqual(['mcp', 'skills']);
  });
});

// ── buildSubprocessArgs ───────────────────────────────────────────────────────

describe('buildSubprocessArgs', () => {
  it('strips --eval and its value', () => {
    expect(buildSubprocessArgs(['--eval', 'react_quickstart', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --output and its value', () => {
    expect(buildSubprocessArgs(['--output', 'scores.json', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --model and its value', () => {
    expect(buildSubprocessArgs(['--model', 'gpt-5.4', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --mode and its value', () => {
    expect(buildSubprocessArgs(['--mode', 'agent', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --tools and its value', () => {
    expect(buildSubprocessArgs(['--tools', 'skills,mcp', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --agent-type and its value', () => {
    expect(buildSubprocessArgs(['--agent-type', 'claude-code', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips boolean --matrix flag', () => {
    expect(buildSubprocessArgs(['--matrix', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips multiple per-job flags and keeps the rest', () => {
    const argv = [
      '--eval',
      'react_quickstart',
      '--model',
      'gpt-5.4',
      '--mode',
      'agent',
      '--tools',
      'skills',
      '--agent-type',
      'auth0-ReAct-agent',
      '--matrix',
      '--output',
      'scores.json',
      '--workers',
      '8',
      '--keep-workspace',
    ];
    expect(buildSubprocessArgs(argv)).toEqual(['--workers', '8', '--keep-workspace']);
  });

  it('returns empty array when all args are stripped', () => {
    expect(buildSubprocessArgs(['--eval', 'foo', '--model', 'gpt-5.4', '--mode', 'baseline'])).toEqual([]);
  });

  it('returns input unchanged when no per-job flags are present', () => {
    expect(buildSubprocessArgs(['--workers', '4', '--braintrust'])).toEqual(['--workers', '4', '--braintrust']);
  });
});
