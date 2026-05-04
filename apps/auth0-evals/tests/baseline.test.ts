/**
 * Happy path tests for src/runners/baseline.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateCost } from '../src/config/costs.js';
import { runBaseline } from '../src/runners/baseline.js';
import { gradeText } from '../src/agent_eval/grade-text.js';
import { judge } from '@a0/eval-graders';
import { TEST_CONFIG } from './setup-config.js';
import type { EvalDefinition } from '@a0/eval';

const JUDGE_MAX_CODE_CHARS = TEST_CONFIG.judge.maxCodeChars!;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvalDef(evalId = 'react_quickstart') {
  return {
    id: evalId,
    baselineSystemPrompt: 'You are a React developer.',
    userPrompt: 'Add Auth0 authentication to the app.',
  };
}

function makeLlmResponse(content = 'Here is the code.', inputTokens = 100, outputTokens = 200) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
  };
}

// ── estimateCost tests ──────────────────────────────────────────────────────

describe('estimateCost', () => {
  it('uses correct input price for known model', () => {
    const cost = estimateCost('gpt-5.4', 1_000_000, 0);
    expect(cost).toBe(2.5);
  });

  it('uses correct output price for known model', () => {
    const cost = estimateCost('gpt-5.4', 0, 1_000_000);
    expect(cost).toBe(15.0);
  });

  it('sums input and output costs', () => {
    const cost = estimateCost('gpt-5.4', 1_000_000, 1_000_000);
    expect(cost).toBe(17.5);
  });

  it('uses default price for unknown model', () => {
    const cost = estimateCost('unknown-model', 1_000_000, 0);
    expect(cost).toBe(1.0);
  });

  it('returns zero cost for zero tokens', () => {
    const cost = estimateCost('gpt-5.4', 0, 0);
    expect(cost).toBe(0.0);
  });
});

// ── runBaseline tests ────────────────────────────────────────────────────────

describe('runBaseline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a BaselineResult with eval_id and model', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse(),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.evalId).toBe('react_quickstart');
    expect(result.model).toBe('gpt-5.4');
  });

  it('mode is baseline', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse(),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.mode).toBe('baseline');
  });

  it('captures response text', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse('Auth0 code here'),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.responseText).toBe('Auth0 code here');
  });

  it('captures token counts', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse('ok', 500, 250),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(250);
  });

  it('falls back to input_tokens/output_tokens when prompt_tokens fields are absent', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { input_tokens: 300, output_tokens: 150 },
      }),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(150);
  });

  it('prefers prompt_tokens over input_tokens when both are present', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 400, completion_tokens: 200, input_tokens: 1, output_tokens: 1 },
      }),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.inputTokens).toBe(400);
    expect(result.outputTokens).toBe(200);
  });

  it('defaults token counts to zero when usage is missing', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('calculates cost from token counts', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse('ok', 1_000_000, 0),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.costUsd).toBe(2.5);
  });

  it('status is success on happy path', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse(),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.status).toBe('success');
  });

  it('status is failure on error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.status).toBe('failure');
    expect(result.error).toContain('timeout');
  });

  it('records wall time', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse(),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(typeof result.wallTime).toBe('number');
    expect(result.wallTime).toBeGreaterThanOrEqual(0);
  });
});

// ── gradeText — oversized baseline response ─────────────────────────────────

describe('gradeText - enforceMaxChars=false', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not throw when extracted code exceeds JUDGE_MAX_CODE_CHARS', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Looks correct.\n\nyes' } }] }),
    } as unknown as Response);

    const oversizedCode = 'x'.repeat(JUDGE_MAX_CODE_CHARS + 1);
    const text = '```js\n' + oversizedCode + '\n```';
    const evalDef = {
      graders: [judge('Does the code work?')],
    } as unknown as EvalDefinition;

    const results = await gradeText(evalDef, text, 'key');
    expect(results.length).toBe(1);
    expect(results[0].passed).toBe(true);
  });
});
