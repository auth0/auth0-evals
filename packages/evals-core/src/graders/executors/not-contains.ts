/**
 * Grader executor: not_contains
 *
 * Checks that a needle substring is NOT present in any workspace file.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';

export const notContainsExecutor: GraderExecutor = {
  kind: 'not_contains',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const needle = def.needle!;
    const passed =
      (def.caseSensitive ?? true)
        ? !ctx.combinedText.includes(needle)
        : !ctx.combinedLower.includes(needle.toLowerCase());
    return {
      name: def.name,
      kind: def.kind,
      passed,
      detail: `'${needle}' ${passed ? 'NOT found (good)' : 'FOUND (bad)'} in written files`,
      level: def.level,
    };
  },
};
