/**
 * Happy path tests for src/runners/baseline.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateCost } from '../src/config/costs.js';
import { runBaseline } from '../src/runners/baseline.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvalDef(evalId = 'react_quickstart') {
  return {
    id: evalId,
    systemPrompt: 'You are a React developer.',
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
    const cost = estimateCost('gpt-5.2', 1_000_000, 0);
    expect(cost).toBe(1.75);
  });

  it('uses correct output price for known model', () => {
    const cost = estimateCost('gpt-5.2', 0, 1_000_000);
    expect(cost).toBe(14.0);
  });

  it('sums input and output costs', () => {
    const cost = estimateCost('gpt-5.2', 1_000_000, 1_000_000);
    expect(cost).toBe(15.75);
  });

  it('uses default price for unknown model', () => {
    const cost = estimateCost('unknown-model', 1_000_000, 0);
    expect(cost).toBe(1.0);
  });

  it('returns zero cost for zero tokens', () => {
    const cost = estimateCost('gpt-5.2', 0, 0);
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

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.evalId).toBe('react_quickstart');
    expect(result.model).toBe('gpt-5.2');
  });

  it('mode is baseline', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse(),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.mode).toBe('baseline');
  });

  it('captures response text', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse('Auth0 code here'),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.responseText).toBe('Auth0 code here');
  });

  it('captures token counts', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse('ok', 500, 250),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
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

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('calculates cost from token counts', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse('ok', 1_000_000, 0),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.costUsd).toBe(1.75);
  });

  it('status is success on happy path', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse(),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.status).toBe('success');
  });

  it('status is failure on error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.status).toBe('failure');
    expect(result.error).toContain('timeout');
  });

  it('records wall time', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse(),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(typeof result.wallTime).toBe('number');
    expect(result.wallTime).toBeGreaterThanOrEqual(0);
  });
});
