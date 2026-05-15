/**
 * Baseline runner — pure LLM, no tools.
 *
 * Sends the eval prompt directly to the LLM as a single chat completion.
 * No workspace, no tool execution, no agentic loop.
 */

import {
  estimateCost,
  getFrameworkConfig,
  getLitellmModelMap,
  makeSessionId,
  withRetry,
  LlmApiError,
  BASELINE_TASK_TIMEOUT_MS,
} from '@a0/eval-core';
import type { BaselineResult, EvalDefinition } from '@a0/eval-core';

export async function runBaseline(
  apiKey: string,
  model: string,
  evalDef: Pick<EvalDefinition, 'id' | 'baselineSystemPrompt' | 'userPrompt'>,
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
  if (evalDef.baselineSystemPrompt) {
    messages.push({ role: 'system', content: evalDef.baselineSystemPrompt });
  }
  messages.push({ role: 'user', content: evalDef.userPrompt });

  try {
    const response = await llmCall(apiKey, model, messages);
    const usage = (response.usage as Record<string, number>) ?? {};
    result.inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    result.outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const choices = response.choices as unknown[];
    const choicesRecord = choices?.[0] as Record<string, unknown> | undefined;
    const message = choicesRecord?.message as Record<string, unknown> | undefined;
    result.responseText = (typeof message?.content === 'string' ? message.content : '') ?? '';
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
  const apiModel = getLitellmModelMap()[model] ?? model;
  const payload = JSON.stringify({ model: apiModel, messages, temperature: 0.0 });

  return withRetry(async () => {
    const baseUrl = getFrameworkConfig().proxy.baseUrl;
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: payload,
      signal: AbortSignal.timeout(BASELINE_TASK_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new LlmApiError(resp.status, body);
    }

    return resp.json() as Promise<Record<string, unknown>>;
  });
}
