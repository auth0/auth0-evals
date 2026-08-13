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
    const caseSensitive = def.caseSensitive ?? true;
    const inFiles = caseSensitive
      ? ctx.combinedText.includes(needle)
      : ctx.combinedLower.includes(needle.toLowerCase());
    const inAgent = ctx.agentText
      ? caseSensitive
        ? ctx.agentText.includes(needle)
        : ctx.agentText.toLowerCase().includes(needle.toLowerCase())
      : false;
    const passed = !inFiles && !inAgent;
    const foundIn = inFiles && inAgent ? 'written files and agent reply' : inFiles ? 'written files' : 'agent reply';
    return {
      name: def.name,
      kind: def.kind,
      passed,
      detail: `'${needle}' ${passed ? 'NOT found (good)' : `FOUND in ${foundIn} (bad)`}`,
      level: def.level,
    };
  },
};
