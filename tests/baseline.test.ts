/**
 * Happy path tests for src/runners/baseline.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateCost } from '../config/costs.js';
import { runBaseline, llmCall, type BaselineResult } from '../runners/baseline.js';

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
    expect(cost).toBe(10.0);
  });

  it('uses correct output price for known model', () => {
    const cost = estimateCost('gpt-5.2', 0, 1_000_000);
    expect(cost).toBe(30.0);
  });

  it('sums input and output costs', () => {
    const cost = estimateCost('gpt-5.2', 1_000_000, 1_000_000);
    expect(cost).toBe(40.0);
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

  it('calculates cost from token counts', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeLlmResponse('ok', 1_000_000, 0),
    } as unknown as Response);

    const result = await runBaseline('key', 'gpt-5.2', makeEvalDef());
    expect(result.costUsd).toBe(10.0);
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
