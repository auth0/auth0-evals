import { describe, it, expect } from 'vitest';
import { serialiseAgent, serialiseBaseline } from '../src/serializers.js';
import type { RunRecord, ScoredResult } from '../src/types/scorer.js';
import type { EvalDefinition } from '../src/types/eval.js';
import type { BaselineResult } from '../src/serializers.js';

const EVAL: EvalDefinition = { id: 'passkeys_react', category: 'passkeys', path: 'p', userPrompt: 'q', graders: [] };

const BASELINE: BaselineResult = {
  evalId: 'passkeys_react',
  model: 'm',
  mode: 'baseline',
  sessionId: 's',
  responseText: 'r',
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0,
  wallTime: 1,
  status: 'success',
  error: '',
};

const RECORD: RunRecord = {
  taskName: 't',
  model: 'm',
  sessionId: 's',
  startTime: 0,
  endTime: 1,
  toolCalls: [],
  turnMetrics: [],
  providerErrors: [],
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  status: 'success',
  finalSummary: '',
  workspace: '/tmp',
};

const SCORED: ScoredResult = {
  runRecord: RECORD,
  dimensions: [],
  overallScore: 90,
  overallGrade: 'A',
  graderResults: [],
  graderPassRate: 1,
};

describe('serialisers — split', () => {
  it('serialiseBaseline copies the eval split', () => {
    expect(serialiseBaseline({ ...EVAL, split: 'heldout' }, BASELINE, [], 'r').split).toBe('heldout');
  });

  it('serialiseAgent copies the eval split', () => {
    const result = serialiseAgent({ ...EVAL, split: 'heldout' }, RECORD, SCORED, [], 'm', 'agent', []);
    expect(result.split).toBe('heldout');
  });

  it('omits the split key when the eval has none', () => {
    expect('split' in serialiseBaseline(EVAL, BASELINE, [], 'r')).toBe(false);
    expect('split' in serialiseAgent(EVAL, RECORD, SCORED, [], 'm', 'agent', [])).toBe(false);
  });
});
