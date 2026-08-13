/**
 * Grader executor: contains
 *
 * Checks that a needle substring is present in workspace files and/or the
 * agent's final reply, depending on the grader's `source` option.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';
import { searchCorpus } from './search-corpus.js';

export const containsExecutor: GraderExecutor = {
  kind: 'contains',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const needle = def.needle!;
    const caseSensitive = def.caseSensitive ?? true;
    const source = def.source ?? 'files';

    const { inFiles, inAgent } = searchCorpus(ctx, needle, caseSensitive, source);

    const passed = inFiles || inAgent;
    const foundIn = inAgent && !inFiles ? 'agent reply' : 'written files';
    const searchScope =
      source === 'files' ? 'written files' : source === 'response' ? 'agent reply' : 'written files or agent reply';

    return {
      name: def.name,
      kind: def.kind,
      passed,
      detail: `'${needle}' ${passed ? `found in ${foundIn}` : `NOT found in ${searchScope}`}`,
      level: def.level,
    };
  },
};
