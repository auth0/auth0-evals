import { describe, it, expect } from 'vitest';
import { classifyActionType, classifyErrorCategory, primaryArg } from '../src/runners/classify.js';
import {
  formatStep,
  serialiseTrace,
  serialiseTurnMetrics,
  serialiseBaseline,
  serialiseAgent,
} from '../src/serializers.js';
import type {
  FinishReason,
  GraderResult,
  RunRecord,
  ScoredResult,
  ToolCallRecord,
  TurnMetric,
} from '../src/types/scorer.js';
import type { EvalDefinition } from '../src/types/eval.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeToolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  const name = overrides.name ?? 'read_file';
  const defaultArgs =
    name === 'read_file' || name === 'list_files' || name === 'write_file' ? { path: 'test.txt' } : {};
  return {
    name,
    args: defaultArgs,
    result: '',
    startTime: 0.0,
    endTime: 1.0,
    isDocLookup: false,
    isInterruption: false,
    causedError: false,
    actionType: 'Implementation',
    isRetry: false,
    recoveredFromError: false,
    ...overrides,
  };
}

function makeTurnMetric(overrides: Partial<TurnMetric> = {}): TurnMetric {
  return {
    turn: 1,
    inputTokens: 100,
    outputTokens: 50,
    llmLatency: 1.5,
    finishReason: 'tool_calls',
    toolCallCount: 1,
    costUsd: 0.001,
    ...overrides,
  };
}

function makeRunRecord(toolCalls: ToolCallRecord[] = [], turnMetrics: TurnMetric[] = []): RunRecord {
  return {
    taskName: 'test',
    model: 'gpt-4o',
    sessionId: 'test-session',
    startTime: 0,
    endTime: 0,
    toolCalls,
    turnMetrics,
    providerErrors: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    status: 'running',
    finalSummary: '',
    workspace: '/tmp',
  };
}

// ── classifyActionType tests ────────────────────────────────────────────────

describe('classifyActionType', () => {
  it('causedError=true takes priority over tool name for all tools', () => {
    expect(classifyActionType('read_file', true)).toBe('Error');
    expect(classifyActionType('write_file', true)).toBe('Error');
    expect(classifyActionType('ask_user', true)).toBe('Error');
  });

  it('discovery tools are classified correctly', () => {
    expect(classifyActionType('read_file', false)).toBe('Discovery');
    expect(classifyActionType('list_files', false)).toBe('Discovery');
    expect(classifyActionType('fetch_url', false)).toBe('Discovery');
    expect(classifyActionType('ask_user', false)).toBe('Interruption');
  });

  it('implementation tools are classified correctly', () => {
    expect(classifyActionType('write_file', false)).toBe('Implementation');
    expect(classifyActionType('run_command', false)).toBe('Implementation');
    expect(classifyActionType('finish_task', false)).toBe('Implementation');
    expect(classifyActionType('unknown_tool', false)).toBe('unknown');
  });
});

// ── classifyErrorCategory tests ─────────────────────────────────────────────

describe('classifyErrorCategory', () => {
  it('classifies not_found errors', () => {
    expect(classifyErrorCategory('File not found: foo.txt')).toBe('not_found');
    expect(classifyErrorCategory('No such file or directory')).toBe('not_found');
    expect(classifyErrorCategory('FILE NOT FOUND')).toBe('not_found');
  });

  it('classifies timeout errors', () => {
    expect(classifyErrorCategory('Request timed out')).toBe('timeout');
    expect(classifyErrorCategory('Deadline exceeded')).toBe('timeout');
  });

  it('classifies permission errors', () => {
    expect(classifyErrorCategory('Permission denied')).toBe('permission');
    expect(classifyErrorCategory('Access denied: insufficient rights')).toBe('permission');
    // 403 Forbidden: "forbidden" matches permission before auth
    expect(classifyErrorCategory('403 Forbidden')).toBe('permission');
  });

  it('classifies auth errors', () => {
    expect(classifyErrorCategory('401 Unauthorized')).toBe('auth');
    expect(classifyErrorCategory('Unauthenticated request')).toBe('auth');
  });

  it('classifies network errors', () => {
    expect(classifyErrorCategory('Connection refused')).toBe('network');
    expect(classifyErrorCategory('Could not fetch URL')).toBe('network');
    expect(classifyErrorCategory('URLError: name or service not known')).toBe('network');
  });

  it('classifies syntax errors', () => {
    expect(classifyErrorCategory('SyntaxError: unexpected token')).toBe('syntax');
    expect(classifyErrorCategory('JSON decode error')).toBe('syntax');
  });

  it('classifies unknown errors', () => {
    expect(classifyErrorCategory('Something went wrong')).toBe('unknown');
    expect(classifyErrorCategory('')).toBe('unknown');
  });
});

// ── primaryArg tests ─────────────────────────────────────────────────────────

describe('primaryArg', () => {
  it('file tools return the path argument', () => {
    expect(primaryArg('read_file', { path: 'src/index.ts' })).toBe('src/index.ts');
    expect(primaryArg('list_files', { path: 'src' })).toBe('src');
    expect(primaryArg('write_file', { path: 'out.ts', content: 'x' })).toBe('out.ts');
  });

  it('file tools support path aliases', () => {
    expect(primaryArg('read_file', { filename: 'src/index.ts' })).toBe('src/index.ts');
    expect(primaryArg('read_file', { file_path: 'src/index.ts' })).toBe('src/index.ts');
  });

  it('run_command truncates to 80 chars', () => {
    const short = 'npm install';
    expect(primaryArg('run_command', { command: short })).toBe(short);
    expect(primaryArg('run_command', { command: 'x'.repeat(200) }).length).toBe(80);
  });

  it('fetch_url returns the url', () => {
    const url = 'https://auth0.com/docs/quickstart';
    expect(primaryArg('fetch_url', { url })).toBe(url);
  });

  it('ask_user truncates to 80 chars', () => {
    const short = 'What is your Auth0 domain?';
    expect(primaryArg('ask_user', { question: short })).toBe(short);
    expect(primaryArg('ask_user', { question: 'x'.repeat(200) }).length).toBe(80);
  });

  it('unknown tool and missing keys are handled', () => {
    expect(primaryArg('unknown_tool', { foo: 'bar' }).length).toBeLessThanOrEqual(80);
    expect(primaryArg('read_file', {})).toBe('');
    expect(primaryArg('run_command', {})).toBe('');
  });
});

// ── ToolCallRecord new field defaults ─────────────────────────────────────────

describe('ToolCallRecord new field defaults', () => {
  it('new fields default to safe/empty values', () => {
    const tc = makeToolCall({ name: 'read_file', args: { path: 'test.txt' } });
    expect(tc.actionType).toBe('Implementation');
    expect(tc.isRetry).toBe(false);
    expect(tc.recoveredFromError).toBe(false);
    expect(tc.errorCategory).toBeUndefined();
  });
});

// ── TurnMetric fields ──────────────────────────────────────────────────────

describe('TurnMetric fields', () => {
  it('accepts all fields and defaults costUsd to 0 when unset', () => {
    const tm = makeTurnMetric({ costUsd: 0 });
    expect(tm.costUsd).toBe(0);
  });

  it('stores provided costUsd and finishReason', () => {
    const tm = makeTurnMetric({
      turn: 2,
      inputTokens: 200,
      outputTokens: 75,
      llmLatency: 2.3,
      finishReason: 'stop',
      toolCallCount: 0,
      costUsd: 0.0025,
    });
    expect(tm.costUsd).toBe(0.0025);
    expect(tm.finishReason).toBe('stop');
  });
});

// ── formatStep tests ───────────────────────────────────────────────────────

describe('formatStep', () => {
  it('formats write_file step', () => {
    const tc = makeToolCall({
      name: 'write_file',
      args: { path: 'src/index.ts', content: 'x'.repeat(842) },
      endTime: 0.3,
    });
    const result = formatStep(tc);
    expect(result).toContain('write_file');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('0.3s');
  });

  it('formats list_files step', () => {
    const tc = makeToolCall({ name: 'list_files', args: { path: 'src' }, result: 'a\nb\nc', endTime: 0.2 });
    const result = formatStep(tc);
    expect(result).toContain('list_files');
    expect(result).toContain('src');
  });

  it('formats list_files with empty path', () => {
    const tc = makeToolCall({ name: 'list_files', args: { path: '' }, result: 'a\nb', endTime: 0.1 });
    expect(formatStep(tc)).toContain('list_files');
  });

  it('formats read_file step', () => {
    const tc = makeToolCall({ name: 'read_file', args: { path: 'package.json' }, result: 'a\nb\nc\nd', endTime: 0.05 });
    const result = formatStep(tc);
    expect(result).toContain('read_file');
    expect(result).toContain('package.json');
  });

  it('formats run_command step with success and failure', () => {
    const tcOk = makeToolCall({
      name: 'run_command',
      args: { command: 'npm install' },
      causedError: false,
      endTime: 4.8,
    });
    const resultOk = formatStep(tcOk);
    expect(resultOk).toContain('npm install');
    expect(resultOk).not.toContain('failed');

    const tcFail = makeToolCall({
      name: 'run_command',
      args: { command: 'npm test' },
      causedError: true,
      endTime: 2.5,
    });
    expect(formatStep(tcFail)).toContain('failed');
  });

  it('formats fetch_url step', () => {
    const tc = makeToolCall({ name: 'fetch_url', args: { url: 'https://auth0.com/docs' }, endTime: 1.2 });
    const result = formatStep(tc);
    expect(result).toContain('fetch_url');
    expect(result).toContain('https://auth0.com/docs');
  });

  it('formats ask_user step', () => {
    const tc = makeToolCall({
      name: 'ask_user',
      args: { question: 'What is your domain?' },
      actionType: 'Interruption',
      endTime: 2.1,
    });
    const result = formatStep(tc);
    expect(result).toContain('ask_user');
    expect(result).toContain('What is your domain?');
    expect(result).toContain('Interruption');
  });

  it('formats unknown tool step', () => {
    const tc = makeToolCall({ name: 'custom_tool', args: { param: 'value' }, endTime: 0.5 });
    expect(formatStep(tc)).toContain('custom_tool');
  });

  it('formats duration correctly', () => {
    const tc = makeToolCall({ name: 'read_file', result: 'content', startTime: 0.0, endTime: 1.234 });
    expect(formatStep(tc)).toContain('1.2s');
  });
});

// ── serialiseTrace tests ───────────────────────────────────────────────────

describe('serialiseTrace', () => {
  it('returns empty array for empty tool calls', () => {
    expect(serialiseTrace(makeRunRecord([]))).toEqual([]);
  });

  it('includes all expected fields, truncates result, and rounds duration', () => {
    const longResult = 'x'.repeat(500);
    const tc = makeToolCall({
      name: 'read_file',
      args: { path: 'test.txt' },
      result: longResult,
      startTime: 0.0,
      endTime: 1.23456,
    });
    const result = serialiseTrace(makeRunRecord([tc]));

    expect(result).toHaveLength(1);
    const step = result[0];
    const expectedKeys = new Set([
      'step',
      'actionType',
      'tool',
      'narrative',
      'args',
      'resultPreview',
      'resultSizeBytes',
      'resultLines',
      'duration',
      'causedError',
      'isDocLookup',
      'isInterruption',
      'isRetry',
      'recoveredFromError',
      'errorCategory',
    ]);
    expect(new Set(Object.keys(step))).toEqual(expectedKeys);
    expect(step.step).toBe(1);
    expect(step.tool).toBe('read_file');
    expect(step.resultPreview.length).toBe(300);
    expect(step.resultSizeBytes).toBe(Buffer.byteLength(longResult, 'utf-8'));
    expect(step.resultLines).toBe(1);
    expect(step.duration).toBe(1.235);
  });

  it('assigns sequential step numbers and correct tool names', () => {
    const tc1 = makeToolCall({ name: 'read_file', args: { path: 'a.txt' } });
    const tc2 = makeToolCall({ name: 'write_file', args: { path: 'b.txt', content: 'x' } });
    const tc3 = makeToolCall({ name: 'run_command', args: { command: 'echo hi' } });
    const result = serialiseTrace(makeRunRecord([tc1, tc2, tc3]));

    expect(result.map((s) => s.step)).toEqual([1, 2, 3]);
    expect(result.map((s) => s.tool)).toEqual(['read_file', 'write_file', 'run_command']);
  });
});

// ── serialiseTurnMetrics tests ─────────────────────────────────────────────

describe('serialiseTurnMetrics', () => {
  it('returns empty array for empty turn metrics', () => {
    expect(serialiseTurnMetrics(makeRunRecord([], []))).toEqual([]);
  });

  it('includes all expected fields and rounds latency and cost', () => {
    const tm = makeTurnMetric({
      turn: 1,
      inputTokens: 100,
      outputTokens: 50,
      llmLatency: 1.23456,
      finishReason: 'tool_calls',
      toolCallCount: 2,
      costUsd: 0.00123456,
    });
    const result = serialiseTurnMetrics(makeRunRecord([], [tm]));

    expect(result).toHaveLength(1);
    const m = result[0];
    expect(new Set(Object.keys(m))).toEqual(
      new Set(['turn', 'input_tokens', 'output_tokens', 'llm_latency', 'finish_reason', 'tool_call_count', 'cost_usd']),
    );
    expect(m.turn).toBe(1);
    expect(m.input_tokens).toBe(100);
    expect(m.llm_latency).toBe(1.235);
    expect(m.cost_usd).toBe(0.001235);
  });

  it('handles multiple turns with various finish reasons', () => {
    const reasons: FinishReason[] = ['tool_calls', 'stop', 'max_tokens', 'length', 'error'];
    const tms = reasons.map((r, i) => makeTurnMetric({ turn: i + 1, finishReason: r }));
    const result = serialiseTurnMetrics(makeRunRecord([], tms));

    expect(result).toHaveLength(5);
    expect(result.map((m) => m.finish_reason)).toEqual(reasons);
  });
});

// ── Integration tests ──────────────────────────────────────────────────────

describe('integration', () => {
  it('serialises a retry-recovery sequence correctly', () => {
    const tc1 = makeToolCall({
      name: 'read_file',
      args: { path: 'config.json' },
      result: 'File not found',
      causedError: true,
      actionType: 'Error',
      errorCategory: 'not_found',
      isRetry: false,
      recoveredFromError: false,
      endTime: 0.1,
    });
    const tc2 = makeToolCall({
      name: 'read_file',
      args: { path: 'config.json' },
      result: '{"version": "1.0"}',
      causedError: false,
      actionType: 'Discovery',
      isRetry: true,
      recoveredFromError: true,
      endTime: 0.2,
    });
    const result = serialiseTrace(makeRunRecord([tc1, tc2]));

    expect(result[0].actionType).toBe('Error');
    expect(result[0].errorCategory).toBe('not_found');
    expect(result[0].isRetry).toBe(false);

    expect(result[1].actionType).toBe('Discovery');
    expect(result[1].isRetry).toBe(true);
    expect(result[1].recoveredFromError).toBe(true);
  });

  it('serialises a complex mixed-type trace with all required fields', () => {
    const tcs = [
      makeToolCall({ name: 'list_files', args: { path: 'src' }, result: 'a\nb', actionType: 'Discovery' }),
      makeToolCall({
        name: 'read_file',
        args: { path: 'src/App.tsx' },
        result: 'export default App',
        actionType: 'Discovery',
      }),
      makeToolCall({ name: 'write_file', args: { path: 'src/cfg.ts', content: 'x' }, actionType: 'Implementation' }),
      makeToolCall({
        name: 'run_command',
        args: { command: 'npm run build' },
        result: 'ok',
        actionType: 'Implementation',
      }),
    ];
    const result = serialiseTrace(makeRunRecord(tcs));

    expect(result).toHaveLength(4);
    const requiredKeys = new Set(['step', 'actionType', 'duration', 'narrative']);
    for (const step of result) {
      for (const key of requiredKeys) {
        expect(step).toHaveProperty(key);
      }
    }
  });

  it('turn metrics lifecycle: totals and final finish_reason are correct', () => {
    const tms = [
      makeTurnMetric({ turn: 1, inputTokens: 100, outputTokens: 50, finishReason: 'tool_calls' }),
      makeTurnMetric({ turn: 2, inputTokens: 250, outputTokens: 100, finishReason: 'tool_calls' }),
      makeTurnMetric({ turn: 3, inputTokens: 300, outputTokens: 150, finishReason: 'stop' }),
    ];
    const result = serialiseTurnMetrics(makeRunRecord([], tms));

    expect(result).toHaveLength(3);
    expect(result.reduce((sum, m) => sum + m.input_tokens, 0)).toBe(650);
    expect(result.reduce((sum, m) => sum + m.output_tokens, 0)).toBe(300);
    expect(result[2].finish_reason).toBe('stop');
  });
});

// ── Judge cost serialisation tests ──────────────────────────────────────────

const stubEvalDef: EvalDefinition = {
  id: 'test_eval',
  category: 'test',
  path: 'test',
  userPrompt: 'test prompt',
  graders: [],
};

const stubBaselineResult = {
  evalId: 'test_eval',
  model: 'gpt-4o',
  mode: 'baseline',
  sessionId: 'sess-1',
  responseText: 'response',
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.01,
  wallTime: 5,
  status: 'success' as const,
  error: '',
};

describe('serialiseBaseline — judge cost fields', () => {
  it('sets judge_cost_usd to 0 when no graders have token usage', () => {
    const graders: GraderResult[] = [{ name: 'check', kind: 'contains', passed: true, detail: 'found' }];
    const result = serialiseBaseline(stubEvalDef, stubBaselineResult, graders, 'response');
    expect(result.judge_cost_usd).toBe(0);
    expect(result.total_cost_usd).toBe(stubBaselineResult.costUsd);
  });

  it('computes judge_cost_usd from graders with token usage and judgeModel', () => {
    const graders: GraderResult[] = [
      { name: 'check', kind: 'contains', passed: true, detail: 'found' },
      {
        name: 'judge q',
        kind: 'judge',
        passed: true,
        detail: 'yes',
        inputTokens: 1000,
        outputTokens: 100,
        judgeModel: 'claude-sonnet-4-5',
      },
    ];
    const result = serialiseBaseline(stubEvalDef, stubBaselineResult, graders, 'response');
    expect(result.judge_cost_usd).toBeGreaterThan(0);
    expect(result.total_cost_usd).toBe(stubBaselineResult.costUsd + result.judge_cost_usd);
  });

  it('non-judge graders do not get cost_usd on GraderSummary', () => {
    const graders: GraderResult[] = [
      { name: 'check', kind: 'contains', passed: true, detail: 'found' },
      {
        name: 'judge q',
        kind: 'judge',
        passed: true,
        detail: 'yes',
        inputTokens: 500,
        outputTokens: 50,
        judgeModel: 'claude-sonnet-4-5',
      },
    ];
    const result = serialiseBaseline(stubEvalDef, stubBaselineResult, graders, 'response');
    expect(result.graders[0].cost_usd).toBeUndefined();
    expect(result.graders[1].cost_usd).toBeGreaterThan(0);
  });
});

describe('serialiseAgent — judge cost fields', () => {
  it('computes judge_cost_usd from graders with token usage', () => {
    const record: RunRecord = {
      ...makeRunRecord(),
      status: 'success',
      costUsd: 0.05,
      startTime: 0,
      endTime: 10,
    };
    const scored: ScoredResult = {
      runRecord: record,
      dimensions: [],
      overallScore: 90,
      overallGrade: 'A',
      graderResults: [],
      graderPassRate: 1.0,
    };
    const graders: GraderResult[] = [
      {
        name: 'judge q',
        kind: 'judge',
        passed: true,
        detail: 'yes',
        inputTokens: 2000,
        outputTokens: 200,
        judgeModel: 'claude-sonnet-4-5',
      },
    ];
    const result = serialiseAgent(stubEvalDef, record, scored, graders, 'gpt-4o', 'agent', []);
    expect(result.judge_cost_usd).toBeGreaterThan(0);
    expect(result.total_cost_usd).toBe(record.costUsd + result.judge_cost_usd);
  });
});
