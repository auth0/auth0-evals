/**
 * Shared text-search helper for contains / not_contains executors.
 *
 * Returns whether the needle appears in workspace files, the agent reply, or
 * both — depending on the grader's `source` option — without combining the
 * two corpora into one string (which would lose the ability to attribute where
 * the match was found for detail messages).
 */

import type { GraderContext } from './types.js';

export interface SearchResult {
  inFiles: boolean;
  inAgent: boolean;
}

export function searchCorpus(ctx: GraderContext, needle: string, caseSensitive: boolean, source: string): SearchResult {
  const checkFiles = source !== 'response';
  const checkResponse = source !== 'files';

  const inFiles = checkFiles
    ? caseSensitive
      ? ctx.combinedText.includes(needle)
      : ctx.combinedLower.includes(needle.toLowerCase())
    : false;

  const inAgent =
    checkResponse && ctx.agentText
      ? caseSensitive
        ? ctx.agentText.includes(needle)
        : ctx.agentText.toLowerCase().includes(needle.toLowerCase())
      : false;

  return { inFiles, inAgent };
}
