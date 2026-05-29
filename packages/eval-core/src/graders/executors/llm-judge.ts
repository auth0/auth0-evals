/**
 * LLM judge grader executor.
 *
 * Handles: judge.
 */

import type { GraderDef, GraderResult } from '@a0/eval-graders';
import type { GraderContext, GraderExecutor } from './types.js';
import { llmJudge } from '../llm-judge.js';
import { logger } from '../../utils/logger.js';

/** File patterns excluded from the LLM judge input to save token budget. */
const JUDGE_EXCLUDED_PATTERNS = [/^tsconfig(\.\w+)?\.json$/, /^angular\.json$/, /^tsconfig\.tsbuildinfo$/];

export const llmJudgeExecutor: GraderExecutor = {
  kind: 'judge',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    if (!ctx.apiKey || !ctx.judge) {
      return {
        name: def.name,
        kind: def.kind,
        passed: false,
        detail: 'Judge grader requires apiKey and judge configuration in context',
        level: def.level,
      };
    }

    const { model, baseUrl, maxTokens, maxCodeChars, modelMap, enforceMaxChars } = ctx.judge;

    const judgeEntries = Object.entries(ctx.files).filter(
      ([k]) => !JUDGE_EXCLUDED_PATTERNS.some((p) => p.test(k.split('/').pop()!)),
    );
    const judgeText = judgeEntries.map(([k, v]) => `// FILE: ${k}\n${v}`).join('\n\n');

    logger.info(`[judge] ${judgeEntries.length} files, ${judgeText.length} chars total (limit: ${maxCodeChars})`);
    for (const [k, v] of judgeEntries) {
      logger.info(`[judge]   ${k} (${v.length} chars)`);
    }
    if (judgeText.length > maxCodeChars) {
      logger.warn(`[judge] WARNING: content exceeds limit (${judgeText.length} > ${maxCodeChars} chars)`);
    }

    const { passed, detail, inputTokens, outputTokens } = await llmJudge({
      question: def.question!,
      code: judgeText,
      apiKey: ctx.apiKey,
      model,
      baseUrl,
      maxTokens,
      modelMap,
      enforceMaxChars,
      maxCodeChars,
    });

    return {
      name: def.name,
      kind: def.kind,
      passed,
      detail,
      level: def.level,
      inputTokens,
      outputTokens,
      judgeModel: model,
    };
  },
};
