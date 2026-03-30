/**
 * Baseline runner — pure LLM, no tools.
 *
 * Sends the eval prompt directly to the LLM as a single chat completion.
 * Graders run against the text of the LLM response (treated as a virtual file).
 * No workspace, no tool execution, no agentic loop.
 */

import { estimateCost } from '../config/costs.js';
import { BASE_URL } from '../config/settings.js';
import { LlmApiError } from '../errors.js';
import { withRetry } from '../utils/retry.js';
import type { EvalDefinition } from './loader.js';

export interface BaselineResult {
  evalId: string;
  model: string;
  mode: string;
  sessionId: string;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  wallTime: number;
  status: 'success' | 'failure';
  error: string;
}

function makeSessionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function runBaseline(
  apiKey: string,
  model: string,
  evalDef: Pick<EvalDefinition, 'id' | 'systemPrompt' | 'userPrompt'>,
): Promise<BaselineResult> {
  const result: BaselineResult = {
    evalId: evalDef.id,
    model,
    mode: 'baseline',
    sessionId: makeSessionId(),
    responseText: '',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    wallTime: 0,
    status: 'success',
    error: '',
  };

  const tStart = Date.now();

  const messages: { role: string; content: string }[] = [];
  if (evalDef.systemPrompt) {
    messages.push({ role: 'system', content: evalDef.systemPrompt });
  }
  messages.push({ role: 'user', content: evalDef.userPrompt });

  try {
    const response = await llmCall(apiKey, model, messages);
    const usage = (response.usage as Record<string, number>) ?? {};
    result.inputTokens = usage.prompt_tokens ?? 0;
    result.outputTokens = usage.completion_tokens ?? 0;
    result.responseText = response.choices?.[0]?.message?.content ?? '';
    result.costUsd = estimateCost(model, result.inputTokens, result.outputTokens);
  } catch (e) {
    result.status = 'failure';
    result.error = String(e);
  }

  result.wallTime = (Date.now() - tStart) / 1000;
  return result;
}

// ── LLM call ──────────────────────────────────────────────────────────────────

export async function llmCall(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify({ model, messages, temperature: 0.0 });

  return withRetry(async () => {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: payload,
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new LlmApiError(resp.status, body);
    }

    return resp.json() as Promise<Record<string, unknown>>;
  });
}
