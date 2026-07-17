/**
 * LLM judge implementation.
 *
 * Extracted into its own module to avoid circular dependencies between
 * engine.ts and executors/llm-judge.ts.
 */

import { JudgeError, LlmApiError } from '../errors.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { SYSTEM_PROMPT, USER_TEMPLATE } from './prompts.generated.js';

// ── LLM Judge ─────────────────────────────────────────────────────────────────

export interface LlmJudgeOptions {
  question: string;
  code: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens?: number;
  enforceMaxChars?: boolean;
  maxCodeChars?: number;
}

export interface LlmJudgeResult {
  passed: boolean;
  detail: string;
  inputTokens: number;
  outputTokens: number;
}

export async function llmJudge(opts: LlmJudgeOptions): Promise<LlmJudgeResult> {
  const { question, code, apiKey, model, baseUrl, enforceMaxChars = true } = opts;
  const judgeMaxCodeChars = opts.maxCodeChars ?? 32_768;
  const judgeMaxTokens = opts.maxTokens ?? 1024;

  if (!model) {
    throw new JudgeError(
      '(none)',
      'No judge model configured. Pass model in LlmJudgeOptions, or configure judge.model in eval.config.js and use runGraders().',
    );
  }
  if (!baseUrl) {
    throw new JudgeError(
      model,
      'No proxy base URL configured. Pass baseUrl in LlmJudgeOptions, or configure proxy.baseUrl in eval.config.js and use runGraders().',
    );
  }

  const system = SYSTEM_PROMPT;
  if (code.length > judgeMaxCodeChars) {
    if (enforceMaxChars) {
      throw new Error(
        `[judge] Code corpus exceeds limit: ${code.length} chars > ${judgeMaxCodeChars}. ` +
          `Increase judge.maxCodeChars or reduce the number or size of files being judged.`,
      );
    }
    logger.warn(`[judge] Code corpus exceeds limit (${code.length} > ${judgeMaxCodeChars} chars) — proceeding anyway`);
  }
  // Use function replacers so `question`/`code` are inserted verbatim. A string
  // replacement would interpret `$&`, `` $` ``, `$'`, and `$1` specially, and
  // since `code` is untrusted agent output this would silently corrupt the prompt.
  const user = USER_TEMPLATE.replace('{question}', () => question).replace('{code}', () => code);

  // The judge hits the /chat/completions endpoint, which serves models under
  // their plain alias, so the model is sent as-is (no Bedrock ID mapping).
  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
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

    const usage = data.usage as Record<string, number> | undefined;
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;

    return { passed: m[1] === 'yes', detail: `Judge (${model}): ${answer}`, inputTokens, outputTokens };
  } catch (e) {
    if (e instanceof JudgeError) throw e;
    throw new JudgeError(model, String(e));
  }
}
