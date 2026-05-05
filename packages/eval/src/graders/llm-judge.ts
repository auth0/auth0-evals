/**
 * LLM judge implementation.
 *
 * Extracted into its own module to avoid circular dependencies between
 * engine.ts and executors/llm-judge.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getLitellmModelMap } from '../config/settings.js';
import { getFrameworkConfig } from '../config/framework-config.js';
import { JudgeError, LlmApiError } from '../errors.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { FRAMEWORK_PROMPTS, USER_TEMPLATE } from './prompts.generated.js';

// ── Prompt loading ────────────────────────────────────────────────────────────

function loadFrameworkPrompt(framework?: string): string {
  const config = getFrameworkConfig();
  const dir = config.judge.promptsDir;

  // Custom prompts directory configured — load from disk.
  // Relative paths are resolved against cwd (the project root at runtime).
  if (dir) {
    const resolved = resolve(dir);
    const name = framework && existsSync(join(resolved, `${framework}.md`)) ? framework : 'default';
    return readFileSync(join(resolved, `${name}.md`), 'utf-8').trim();
  }

  // Built-in prompts generated from src/graders/prompts/*.md at build time.
  const prompt = framework ? FRAMEWORK_PROMPTS[framework] : undefined;
  return prompt ?? FRAMEWORK_PROMPTS['default']!;
}

function loadUserTemplate(): string {
  const config = getFrameworkConfig();
  const dir = config.judge.promptsDir;

  if (dir) {
    return readFileSync(join(resolve(dir), 'user_template.md'), 'utf-8').trim();
  }

  return USER_TEMPLATE;
}

// ── LLM Judge ─────────────────────────────────────────────────────────────────

export interface LlmJudgeOptions {
  question: string;
  code: string;
  apiKey: string;
  model: string;
  framework?: string;
  enforceMaxChars?: boolean;
  maxCodeChars?: number;
}

export async function llmJudge(opts: LlmJudgeOptions): Promise<{ passed: boolean; detail: string }> {
  const { question, code, apiKey, model, framework, enforceMaxChars = true } = opts;
  const config = getFrameworkConfig();
  const judgeMaxCodeChars = opts.maxCodeChars ?? config.judge.maxCodeChars ?? 16_384;
  const judgeMaxTokens = config.judge.maxTokens ?? 1024;
  const baseUrl = config.proxy.baseUrl;

  if (!model) {
    throw new JudgeError('(none)', 'No judge model configured. Set judge.model in eval.config.js or pass judgeModel.');
  }
  if (!baseUrl) {
    throw new JudgeError(model, 'No proxy base URL configured. Set proxy.baseUrl in eval.config.js.');
  }

  const base = loadFrameworkPrompt(framework);
  const system =
    `${base} Provide 1-3 short sentences of reasoning, ` +
    "then on the FINAL line write your verdict as exactly 'yes' or 'no' (nothing else on that line).";
  if (code.length > judgeMaxCodeChars) {
    if (enforceMaxChars) {
      throw new Error(
        `[judge] Code corpus exceeds limit: ${code.length} chars > ${judgeMaxCodeChars}. ` +
          `Increase judge.maxCodeChars or reduce the number or size of files being judged.`,
      );
    }
    logger.warn(`[judge] Code corpus exceeds limit (${code.length} > ${judgeMaxCodeChars} chars) — proceeding anyway`);
  }
  const user = loadUserTemplate().replace('{question}', question).replace('{code}', code);
  const apiModel = getLitellmModelMap()[model] ?? model;

  const payload = JSON.stringify({
    model: apiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.0,
    max_tokens: judgeMaxTokens,
  });

  try {
    const data = await withRetry(async () => {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new LlmApiError(resp.status, body);
      }

      return (await resp.json()) as Record<string, unknown>;
    });
    const choices = data.choices as Record<string, unknown>[] | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const answer = ((message?.content as string | undefined) ?? '').trim();
    if (!answer) {
      throw new JudgeError(model, 'empty response from LLM');
    }
    const lines = answer
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const lastLine = lines[lines.length - 1]!.toLowerCase();
    const m = /^(yes|no)\b/.exec(lastLine);
    if (!m) {
      throw new JudgeError(model, `unexpected verdict ${JSON.stringify(lastLine)}: ${answer}`);
    }
    return { passed: m[1] === 'yes', detail: `Judge (${model}): ${answer}` };
  } catch (e) {
    if (e instanceof JudgeError) throw e;
    throw new JudgeError(model, String(e));
  }
}
