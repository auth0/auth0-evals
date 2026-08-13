/**
 * Grader executor: not_contains
 *
 * Checks that a needle substring is NOT present in workspace files and/or the
 * agent's final reply, depending on the grader's `source` option.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';
import { searchCorpus } from './search-corpus.js';

export const notContainsExecutor: GraderExecutor = {
  kind: 'not_contains',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const needle = def.needle!;
    const caseSensitive = def.caseSensitive ?? true;
    const source = def.source ?? 'files';

    const { inFiles, inAgent } = searchCorpus(ctx, needle, caseSensitive, source);

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
