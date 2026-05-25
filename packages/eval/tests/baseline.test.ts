/**
 * Happy path tests for src/runners/baseline.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateCost, gradeText } from '@a0/eval-core';
import { judge } from '@a0/eval-graders';
import { runBaseline } from '../src/runners/baseline.js';
import { TEST_CONFIG } from './setup-config.js';
import type { EvalDefinition } from '@a0/eval-core';

const JUDGE_MAX_CODE_CHARS = TEST_CONFIG.judge.maxCodeChars!;

// ── Mock for ai / @ai-sdk/openai ──────────────────────────────────────────────

const mockGenerateText = vi.hoisted(() => vi.fn());
const mockCreateOpenAI = vi.hoisted(() => vi.fn());

vi.mock('ai', () => ({ generateText: mockGenerateText }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: mockCreateOpenAI }));

// createOpenAI returns a model-factory; the factory's return value is passed
// straight to generateText — stub both so the chain resolves cleanly.
mockCreateOpenAI.mockReturnValue(() => 'stub-model');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvalDef(evalId = 'react_quickstart') {
  return {
    id: evalId,
    baselineSystemPrompt: 'You are a React developer.',
    userPrompt: 'Add Auth0 authentication to the app.',
  };
}

function makeAiResponse(text = 'Here is the code.', inputTokens = 100, outputTokens = 200) {
  return { text, usage: { inputTokens, outputTokens } };
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
    vi.clearAllMocks();
    mockCreateOpenAI.mockReturnValue(() => 'stub-model');
  });

  it('returns a BaselineResult with eval_id and model', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse());

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.evalId).toBe('react_quickstart');
    expect(result.model).toBe('gpt-5.4');
  });

  it('mode is baseline', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse());

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.mode).toBe('baseline');
  });

  it('captures response text', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse('Auth0 code here'));

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.responseText).toBe('Auth0 code here');
  });

  it('captures token counts', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse('ok', 500, 250));

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(250);
  });

  it('defaults token counts to zero when usage fields are absent', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { inputTokens: undefined, outputTokens: undefined } });

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('calculates cost from token counts', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse('ok', 1_000_000, 0));

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.costUsd).toBe(2.5);
  });

  it('status is success on happy path', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse());

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.status).toBe('success');
  });

  it('status is failure on error', async () => {
    mockGenerateText.mockRejectedValue(new Error('timeout'));

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(result.status).toBe('failure');
    expect(result.error).toContain('timeout');
  });

  it('records wall time', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse());

    const result = await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(typeof result.wallTime).toBe('number');
    expect(result.wallTime).toBeGreaterThanOrEqual(0);
  });

  it('passes system prompt and user prompt to generateText', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse());

    await runBaseline('key', 'gpt-5.4', makeEvalDef());
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a React developer.',
        prompt: 'Add Auth0 authentication to the app.',
        temperature: 0,
      }),
    );
  });

  it('omits system when baselineSystemPrompt is undefined', async () => {
    mockGenerateText.mockResolvedValue(makeAiResponse());

    await runBaseline('key', 'gpt-5.4', { id: 'x', userPrompt: 'hello', baselineSystemPrompt: undefined });
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ system: undefined, prompt: 'hello' }));
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
