/**
 * Grader executor: contains
 *
 * Checks that a needle substring is present in workspace files.
 */

import type { GraderDef, GraderResult } from '@a0/eval-graders';
import type { GraderContext, GraderExecutor } from './types.js';

export const containsExecutor: GraderExecutor = {
  kind: 'contains',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const needle = def.needle!;
    const passed =
      (def.caseSensitive ?? true) ? ctx.combinedText.includes(needle) : ctx.combinedLower.includes(needle.toLowerCase());
    return {
      name: def.name,
      kind: def.kind,
      passed,
      detail: `'${needle}' ${passed ? 'found' : 'NOT found'} in written files`,
      level: def.level,
    };
  },
};
