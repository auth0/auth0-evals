/**
 * Baseline runner — pure LLM, no tools.
 *
 * Sends the eval prompt directly to the LLM as a single chat completion.
 * Graders run against the text of the LLM response (treated as a virtual file).
 * No workspace, no tool execution, no agentic loop.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { estimateCost } from '../config/costs.js';
import { BASE_URL } from '../config/settings.js';
import { LlmApiError } from '../errors.js';
import { withRetry } from '../utils/retry.js';
import { runGraders, GraderLevel } from '../agent_eval/graders.js';
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
    result.responseText = response.choices?.[0]?.message?.content ?? '';
    result.costUsd = estimateCost(model, result.inputTokens, result.outputTokens);
  } catch (e) {
    result.status = 'failure';
    result.error = String(e);
  }

  result.wallTime = (Date.now() - tStart) / 1000;
  return result;
}

// ── Baseline grading ──────────────────────────────────────────────────────────

export const BASELINE_LEVELS = new Set([GraderLevel.L1, GraderLevel.L2, GraderLevel.L3]);

/** Agent without MCP: L1-L4. No version-correctness without docs access. */
export const AGENT_LEVELS = new Set([GraderLevel.L1, GraderLevel.L2, GraderLevel.L3, GraderLevel.L4]);

/** Agent with MCP: L1-L5. Model has docs access, so version drift is a real failure. */
export const AGENT_MCP_LEVELS = new Set([
  GraderLevel.L1,
  GraderLevel.L2,
  GraderLevel.L3,
  GraderLevel.L4,
  GraderLevel.L5,
]);

/**
 * Extracts fenced code blocks from an LLM response.
 * If multiple blocks exist they are joined with a blank line.
 * Falls back to the text after the opening fence if the block is unclosed,
 * or the raw text if no fence is present at all.
 */
export function extractCodeBlocks(text: string): string {
  const blocks = [...text.matchAll(/^[ \t]{0,3}```[^\r\n]*\r?\n([\s\S]*?)^[ \t]{0,3}```[ \t]*\r?$/gm)].map((m) => m[1]);
  if (blocks.length > 0) {
    return blocks.join('\n\n');
  }
  const openingFenceMatch = /^[ \t]{0,3}```[^\r\n]*\r?\n/m.exec(text);
  if (openingFenceMatch) {
    return text.slice(openingFenceMatch.index + openingFenceMatch[0].length);
  }
  return text;
}

export async function gradeText(
  evalDef: EvalDefinition,
  text: string,
  apiKey: string,
  allowedLevels?: Set<GraderLevel>,
): Promise<Awaited<ReturnType<typeof runGraders>>> {
  const code = extractCodeBlocks(text);
  const tmp = mkdtempSync(join(tmpdir(), 'auth0_eval_grade_'));
  try {
    writeFileSync(join(tmp, 'llm_response.txt'), code, 'utf-8');
    return await runGraders(evalDef.graders, tmp, apiKey, undefined, allowedLevels);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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
