/**
 * LLM judge grader executor.
 *
 * Handles: judge.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';
import { llmJudge } from '../llm-judge.js';
import { logger } from '../../utils/logger.js';

/**
 * File patterns (matched against the basename) excluded from the LLM judge input.
 *
 * `tsconfig*.json` / `angular.json` are dropped to save token budget. `.env*` files
 * are dropped so credential values never reach the judge LLM — security graders verify
 * secret absence in source deterministically via `notContainsInSource`, and "wired into
 * .env" is an event-based (`wroteFile`) concern, so the judge never needs `.env` content.
 *
 * `.md` / `.txt` files are dropped because agents routinely emit large standalone docs
 * (integration guides, summaries, checklists) that are not source code. They inflate the
 * corpus — sometimes past `maxCodeChars`, which fails the judge outright — while adding no
 * signal the judge needs.
 */
const JUDGE_EXCLUDED_PATTERNS = [
  /^tsconfig(\.\w+)?\.json$/,
  /^angular\.json$/,
  /^tsconfig\.tsbuildinfo$/,
  /\.md$/i,
  /\.txt$/i,
  /^\.env(\..*)?$/,
];

/** Directory paths (matched against the relative path) excluded from the LLM judge input — large Android build artifacts. */
const JUDGE_EXCLUDED_DIRS = ['.gradle', 'app/build'];

export function isJudgeExcluded(relPath: string): boolean {
  const basename = relPath.split('/').pop()!;
  if (JUDGE_EXCLUDED_PATTERNS.some((p) => p.test(basename))) return true;
  return JUDGE_EXCLUDED_DIRS.some((dir) => relPath === dir || relPath.startsWith(dir + '/'));
}

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

    const { model, baseUrl, maxTokens, maxCodeChars, enforceMaxChars } = ctx.judge;

    const judgeEntries = Object.entries(ctx.files).filter(([k]) => !isJudgeExcluded(k));
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
