/**
 * Text grading utilities for baseline mode.
 *
 * Extracts code blocks from LLM responses and grades them in a temporary
 * workspace using the standard grader pipeline.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { GraderLevel } from '@a0/evals-graders';
import { runGraders } from './engine.js';
import type { EvalDefinition } from '../types/eval.js';

/**
 * Extracts fenced code blocks from an LLM response.
 * If multiple blocks exist they are joined with a blank line.
 * Falls back to the text after the opening fence if the block is unclosed,
 * or the raw text if no fence is present at all.
 */
export function extractCodeBlocks(text: string): string {
  const blocks = [...text.matchAll(/^[ \t]{0,3}```[^\r\n]*\r?\n([\s\S]*?)^[ \t]{0,3}```[ \t]*\r?$/gm)].map((m) => m[1]);
  if (blocks.length > 0) {
    return blocks.join('\n\n');
  }
  const openingFenceMatch = /^[ \t]{0,3}```[^\r\n]*\r?\n/m.exec(text);
  if (openingFenceMatch) {
    return text.slice(openingFenceMatch.index + openingFenceMatch[0].length);
  }
  return text;
}

export async function gradeText(
  evalDef: EvalDefinition,
  text: string,
  apiKey: string,
  allowedLevels?: Set<GraderLevel>,
): Promise<Awaited<ReturnType<typeof runGraders>>> {
  const code = extractCodeBlocks(text);
  const tmp = mkdtempSync(join(tmpdir(), 'eval_grade_'));
  try {
    writeFileSync(join(tmp, 'llm_response.txt'), code, 'utf-8');
    return await runGraders(evalDef.graders, tmp, apiKey, undefined, allowedLevels, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
