/**
 * Grader executor: contains
 *
 * Checks that a needle substring is present in workspace files.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';

export const containsExecutor: GraderExecutor = {
  kind: 'contains',

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
    const passed = inFiles || inAgent;
    const source = inAgent && !inFiles ? 'agent reply' : 'written files';
    return {
      name: def.name,
      kind: def.kind,
      passed,
      detail: `'${needle}' ${passed ? `found in ${source}` : 'NOT found in written files or agent reply'}`,
      level: def.level,
    };
  },
};
