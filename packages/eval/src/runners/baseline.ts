/**
 * Baseline runner — pure LLM, no tools.
 *
 * Sends the eval prompt directly to the LLM as a single chat completion
 * via the Vercel AI SDK (generateText). Routes through the configured
 * OpenAI-compatible proxy (same baseUrl used by all other runners).
 * No workspace, no tool execution, no agentic loop.
 */

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import {
  estimateCost,
  getFrameworkConfig,
  getModelIdMap,
  makeSessionId,
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

  try {
    const { text, usage } = await llmCall(apiKey, model, evalDef.baselineSystemPrompt, evalDef.userPrompt);
    result.responseText = text;
    result.inputTokens = usage.inputTokens ?? 0;
    result.outputTokens = usage.outputTokens ?? 0;
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
  systemPrompt: string | undefined,
  userPrompt: string,
): Promise<{ text: string; usage: { inputTokens: number | undefined; outputTokens: number | undefined } }> {
  const { proxy } = getFrameworkConfig();
  const apiModel = getModelIdMap()[model] ?? model;

  const openai = createOpenAI({
    apiKey,
    baseURL: proxy.baseUrl,
  });

  return generateText({
    model: openai(apiModel),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0,
    abortSignal: AbortSignal.timeout(BASELINE_TASK_TIMEOUT_MS),
  });
}
