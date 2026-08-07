import { describe, it, expect } from 'vitest';
import { buildAxisScores, countInterruptions, scoreToGrade } from '../src/report.js';
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
// countInterruptions
// ---------------------------------------------------------------------------

describe('countInterruptions', () => {
  it('returns 0 for an empty transcript', () => {
    expect(countInterruptions([])).toBe(0);
  });

  it('returns 0 when no interruption tools are called', () => {
    const transcript = [
      { type: 'tool_use', timestamp: '', content: { name: 'write_file', id: 't1', input: {} } },
      { type: 'tool_result', timestamp: '', content: { tool_use_id: 't1', content: 'ok' } },
    ] as never;
    expect(countInterruptions(transcript)).toBe(0);
  });

  it('counts AskUserQuestion in standard tool_use entries (claude-code runner)', () => {
    const transcript = [
      { type: 'tool_use', timestamp: '', content: { name: 'AskUserQuestion', id: 't1', input: {} } },
      { type: 'tool_use', timestamp: '', content: { name: 'AskUserQuestion', id: 't2', input: {} } },
      { type: 'tool_use', timestamp: '', content: { name: 'write_file', id: 't3', input: {} } },
    ] as never;
    expect(countInterruptions(transcript)).toBe(2);
  });

  it('counts ask_user in standard tool_use entries (copilot runner)', () => {
    const transcript = [
      { type: 'tool_use', timestamp: '', content: { name: 'ask_user', id: 't1', input: {} } },
    ] as never;
    expect(countInterruptions(transcript)).toBe(1);
  });

  it('counts AskUserQuestion nested inside assistant entries (claude-code AXIS adapter)', () => {
    const transcript = [
      {
        type: 'assistant',
        timestamp: '',
        content: {
          message: {
            content: [
              { type: 'tool_use', name: 'write_file' },
              { type: 'tool_use', name: 'AskUserQuestion' },
            ],
          },
        },
      },
    ] as never;
    expect(countInterruptions(transcript)).toBe(1);
  });

  it('handles mixed standard and assistant-nested formats', () => {
    const transcript = [
      { type: 'tool_use', timestamp: '', content: { name: 'AskUserQuestion', id: 't1', input: {} } },
      {
        type: 'assistant',
        timestamp: '',
        content: {
          message: { content: [{ type: 'tool_use', name: 'AskUserQuestion' }] },
        },
      },
    ] as never;
    expect(countInterruptions(transcript)).toBe(2);
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

  it('maps totalCostUsd to cost_usd and total_cost_usd, leaving judge_cost_usd as 0 when no judge graders ran', () => {
    const output = makeScoredOutput({ totalCostUsd: 0.05 });
    const [result] = buildAxisScores(output, new Map());

    expect(result.cost_usd).toBe(0.05);
    expect(result.total_cost_usd).toBe(0.05);
    expect(result.judge_cost_usd).toBe(0);
  });

  it('computes judge_cost_usd from grader token usage and adds it to total_cost_usd', () => {
    // claude-opus-5: $5/M input, $25/M output
    // 1000 input + 200 output = (1000×5 + 200×25) / 1_000_000 = 0.01
    const graders: GraderResult[] = [
      {
        name: 'Holistic judge',
        kind: 'judge',
        passed: true,
        detail: 'yes',
        inputTokens: 1000,
        outputTokens: 200,
        judgeModel: 'claude-opus-5',
      },
    ];
    const output = makeScoredOutput({ totalCostUsd: 0.05 });
    const map = new Map([['react_quickstart|claude-code|global.anthropic.claude-opus-4-8', graders]]);
    const [result] = buildAxisScores(output, map);

    expect(result.cost_usd).toBe(0.05);
    expect(result.judge_cost_usd).toBeCloseTo(0.01, 6);
    expect(result.total_cost_usd).toBeCloseTo(0.06, 6);
  });

  it('sets judge_cost_usd to 0 when graders have no token usage', () => {
    const graders: GraderResult[] = [{ name: 'Uses SDK', kind: 'contains', passed: true, detail: 'found' }];
    const output = makeScoredOutput({ totalCostUsd: 0.02 });
    const map = new Map([['react_quickstart|claude-code|global.anthropic.claude-opus-4-8', graders]]);
    const [result] = buildAxisScores(output, map);

    expect(result.judge_cost_usd).toBe(0);
    expect(result.total_cost_usd).toBe(0.02);
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

  it('uses transcriptAnalysis.toolUseCount for tool_calls when available (claude-code adapter)', () => {
    // The claude-code adapter embeds tool calls inside assistant entries — the raw
    // transcript never has type==='tool_use'. transcriptAnalysis.toolUseCount is
    // populated by AXIS scoring after re-classifying those entries, so it reflects
    // the real call count even when the raw transcript count is 0.
    const output = makeScoredOutput({});
    output.results[0].output.transcript = [
      { type: 'assistant', content: { message: { content: [{ type: 'tool_use', name: 'write_file' }] } } },
    ] as never;
    output.results[0].output.transcriptAnalysis = { toolUseCount: 5 } as never;
    const [result] = buildAxisScores(output, new Map());

    expect(result.tool_calls).toBe(5);
  });

  it('uses category from the categories map when provided', () => {
    const output = makeScoredOutput({ scenarioKey: 'react_quickstart' });
    const [result] = buildAxisScores(output, new Map(), { react_quickstart: 'quickstarts' });

    expect(result.category).toBe('quickstarts');
  });

  it('falls back to empty string when scenarioKey is not in the categories map', () => {
    const output = makeScoredOutput({ scenarioKey: 'react_quickstart' });
    const [result] = buildAxisScores(output, new Map(), {});

    expect(result.category).toBe('');
  });

  it('falls back to empty string when categories map is omitted', () => {
    const output = makeScoredOutput({ scenarioKey: 'react_quickstart' });
    const [result] = buildAxisScores(output, new Map());

    expect(result.category).toBe('');
  });

  it('computes active_time from sparseIndex.stats.totalDurationMs', () => {
    const output = makeScoredOutput({});
    output.results[0].score.sparseIndex = { stats: { totalDurationMs: 11840 } } as never;
    const [result] = buildAxisScores(output, new Map());

    expect(result.active_time).toBe(11.84);
  });

  it('sets active_time to 0 when sparseIndex is absent', () => {
    const output = makeScoredOutput({});
    const [result] = buildAxisScores(output, new Map());

    expect(result.active_time).toBe(0);
  });

  it('counts AskUserQuestion tool_use entries as interruptions', () => {
    const output = makeScoredOutput({});
    output.results[0].output.transcript = [
      { type: 'tool_use', timestamp: '', content: { name: 'AskUserQuestion', id: 't1', input: {} } },
      { type: 'tool_use', timestamp: '', content: { name: 'write_file', id: 't2', input: {} } },
    ] as never;
    const [result] = buildAxisScores(output, new Map());

    expect(result.interruptions).toBe(1);
  });

  it('sets cost_usd on GraderSummary for judge graders with token usage', () => {
    // claude-opus-5: $5/M input, $25/M output → (1000×5 + 200×25) / 1_000_000 = 0.01
    const graders: GraderResult[] = [
      {
        name: 'Holistic judge',
        kind: 'judge',
        passed: true,
        detail: 'yes',
        inputTokens: 1000,
        outputTokens: 200,
        judgeModel: 'claude-opus-5',
      },
      { name: 'Uses SDK', kind: 'contains', passed: true, detail: 'found' },
    ];
    const output = makeScoredOutput({});
    const map = new Map([['react_quickstart|claude-code|global.anthropic.claude-opus-4-8', graders]]);
    const [result] = buildAxisScores(output, map);

    expect(result.graders[0].cost_usd).toBeCloseTo(0.01, 6);
    expect(result.graders[1].cost_usd).toBeUndefined();
  });

  it('sets interruptions to 0 when no interruption tools appear in the transcript', () => {
    const output = makeScoredOutput({});
    output.results[0].output.transcript = [
      { type: 'tool_use', timestamp: '', content: { name: 'write_file', id: 't1', input: {} } },
    ] as never;
    const [result] = buildAxisScores(output, new Map());

    expect(result.interruptions).toBe(0);
  });
});
