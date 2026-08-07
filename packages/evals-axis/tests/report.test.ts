import { describe, it, expect } from 'vitest';
import { buildAxisScores, scoreToGrade } from '../src/report.js';
import type { ScoredOutput } from '@netlify/axis';
import type { GraderResult } from '@a0/evals-graders';

// Minimal ScoredOutput fixture for a single result.
function makeScoredOutput(overrides: {
  scenarioKey?: string;
  agentName?: string;
  exitCode?: number;
  axisScore?: number;
  totalCostUsd?: number;
  tokenUsage?: { input: number; output: number; cacheReadInput?: number };
}): ScoredOutput {
  const {
    scenarioKey = 'react_quickstart',
    agentName = 'claude-code|global.anthropic.claude-opus-4-8',
    exitCode = 0,
    axisScore = 80,
    totalCostUsd,
    tokenUsage,
  } = overrides;

  return {
    version: '1',
    timestamp: '2026-01-01T00:00:00Z',
    durationMs: 1000,
    summary: { total: 1, completed: 1, failed: 0 },
    results: [
      {
        scenarioKey,
        scenarioName: scenarioKey,
        agentName,
        prompt: 'Test prompt',
        judge: 'Did it work?',
        agentConfig: {} as never,
        output: {
          transcript: [],
          result: 'Done.',
          metadata: {
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-01-01T00:00:01Z',
            durationMs: 1000,
            exitCode,
            ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
            ...(tokenUsage !== undefined ? { tokenUsage } : {}),
          },
        },
        score: {
          axisScore,
          goalAchievement: { score: axisScore },
          environment: { score: 90 },
          service: { score: 100 },
          agent: { score: 85 },
          weights: {} as never,
        },
      },
    ],
  } as unknown as ScoredOutput;
}

// ---------------------------------------------------------------------------
// scoreToGrade
// ---------------------------------------------------------------------------

describe('scoreToGrade', () => {
  it('returns A for scores >= 90', () => {
    expect(scoreToGrade(90)).toBe('A');
    expect(scoreToGrade(100)).toBe('A');
  });

  it('returns B for scores >= 75 and < 90', () => {
    expect(scoreToGrade(75)).toBe('B');
    expect(scoreToGrade(89)).toBe('B');
  });

  it('returns C for scores >= 60 and < 75', () => {
    expect(scoreToGrade(60)).toBe('C');
    expect(scoreToGrade(74)).toBe('C');
  });

  it('returns D for scores >= 40 and < 60', () => {
    expect(scoreToGrade(40)).toBe('D');
    expect(scoreToGrade(59)).toBe('D');
  });

  it('returns F for scores below 40', () => {
    expect(scoreToGrade(39)).toBe('F');
    expect(scoreToGrade(0)).toBe('F');
  });
});

// ---------------------------------------------------------------------------
// buildAxisScores
// ---------------------------------------------------------------------------

describe('buildAxisScores', () => {
  it('maps a result with graders to AgentJobResult', () => {
    const graders: GraderResult[] = [
      { name: 'Uses SDK', kind: 'contains', passed: true, detail: 'found' },
      { name: 'No secrets', kind: 'not_contains', passed: false, detail: 'found secret' },
    ];
    const output = makeScoredOutput({ axisScore: 80 });
    const map = new Map([['react_quickstart|claude-code|global.anthropic.claude-opus-4-8', graders]]);

    const [result] = buildAxisScores(output, map);

    expect(result.eval_id).toBe('react_quickstart');
    expect(result.overall_score).toBe(80);
    expect(result.overall_grade).toBe('B');
    expect(result.grader_pass_rate).toBe(0.5);
    expect(result.graders).toHaveLength(2);
    expect(result.tools).toEqual(['axis']);
    expect(result.mode).toBe('agent');
  });

  it('produces grader_pass_rate of 0 when no graders are in the map', () => {
    const output = makeScoredOutput({});
    const [result] = buildAxisScores(output, new Map());

    expect(result.grader_pass_rate).toBe(0);
    expect(result.graders).toHaveLength(0);
  });

  it('extracts model and agent_type from agentName', () => {
    const output = makeScoredOutput({ agentName: 'codex|gpt-5-codex' });
    const [result] = buildAxisScores(output, new Map());

    expect(result.model).toBe('gpt-5-codex');
    expect(result.agent_type).toBe('codex');
  });

  it('falls back to claude-code for an unrecognised agent type', () => {
    const output = makeScoredOutput({ agentName: 'unknown-runner|some-model' });
    const [result] = buildAxisScores(output, new Map());

    expect(result.agent_type).toBe('claude-code');
    expect(result.model).toBe('some-model');
  });

  it('uses agentName as model when there is no pipe separator', () => {
    const output = makeScoredOutput({ agentName: 'claude-code' });
    const [result] = buildAxisScores(output, new Map());

    expect(result.model).toBe('claude-code');
  });

  it('sets status to failure when exitCode is non-zero', () => {
    const output = makeScoredOutput({ exitCode: 1 });
    const [result] = buildAxisScores(output, new Map());

    expect(result.status).toBe('failure');
  });

  it('populates tokens from tokenUsage when available', () => {
    const output = makeScoredOutput({
      tokenUsage: { input: 1000, output: 500, cacheReadInput: 200 },
    });
    const [result] = buildAxisScores(output, new Map());

    expect(result.tokens).toBe(1700);
  });

  it('sets tokens to 0 when tokenUsage is absent', () => {
    const output = makeScoredOutput({});
    const [result] = buildAxisScores(output, new Map());

    expect(result.tokens).toBe(0);
  });

  it('maps totalCostUsd to cost_usd and total_cost_usd, leaving judge_cost_usd as 0', () => {
    const output = makeScoredOutput({ totalCostUsd: 0.05 });
    const [result] = buildAxisScores(output, new Map());

    expect(result.cost_usd).toBe(0.05);
    expect(result.total_cost_usd).toBe(0.05);
    expect(result.judge_cost_usd).toBe(0);
  });

  it('produces 4 AXIS dimensions with correct weights', () => {
    const output = makeScoredOutput({ axisScore: 90 });
    const [result] = buildAxisScores(output, new Map());

    expect(result.dimensions).toHaveLength(4);
    const weights = result.dimensions.map((d) => d.weight);
    expect(weights).toEqual([0.4, 0.2, 0.2, 0.2]);
  });

  it('counts only tool_use transcript entries for tool_calls', () => {
    const output = makeScoredOutput({});
    // Inject a transcript with one tool_use and one text entry directly.
    output.results[0].output.transcript = [
      { type: 'tool_use', id: 'tc1', name: 'write_file', input: {} },
      { type: 'text', text: 'Done.' },
    ] as never;
    const [result] = buildAxisScores(output, new Map());

    expect(result.tool_calls).toBe(1);
  });
});
