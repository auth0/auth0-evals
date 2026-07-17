/**
 * Grader executor: matches
 *
 * Checks that a regex pattern matches in workspace files.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';

export const matchesExecutor: GraderExecutor = {
  kind: 'matches',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const pattern = def.pattern!;
    let passed: boolean;
    let detail: string;
    try {
      // Case-insensitive by default; honor caseSensitive to match the other
      // text-search executors (contains/notContains). Always multiline.
      const flags = def.caseSensitive === true ? 'm' : 'im';
      passed = new RegExp(pattern, flags).test(ctx.combinedText);
      detail = `/${pattern}/ ${passed ? 'matched' : 'NOT matched'}`;
    } catch (e) {
      passed = false;
      detail = `/(invalid regex: ${e})/ NOT matched`;
    }
    return { name: def.name, kind: def.kind, passed, detail, level: def.level };
  },
};
