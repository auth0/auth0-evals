/**
 * Grader execution engine.
 *
 * Primitives (contains, notContains, matches, etc.) and types (GraderDef,
 * GraderResult, GraderLevel) are defined in @a0/eval-graders.
 * This file provides the execution engine that evaluates graders against
 * workspace files and runs the LLM judge.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFrameworkConfig } from '../config/framework-config.js';
import { getLitellmModelMap } from '../config/settings.js';
import { collectFiles as collectFilePaths } from '../workspace/index.js';
import type { GraderDef, GraderResult } from '@a0/eval-graders';
import { GraderLevel } from '@a0/eval-graders';
import { registerExecutor, executeGrader } from './executors/index.js';
import { containsExecutor } from './executors/contains.js';
import { notContainsExecutor } from './executors/not-contains.js';
import { notContainsInSourceExecutor } from './executors/not-contains-in-source.js';
import { matchesExecutor } from './executors/matches.js';
import { llmJudgeExecutor } from './executors/llm-judge.js';

// Re-export llmJudge from its dedicated module for backward compatibility.
export { llmJudge } from './llm-judge.js';

// ── Register built-in executors ──────────────────────────────────────────────

registerExecutor(containsExecutor);
registerExecutor(notContainsExecutor);
registerExecutor(notContainsInSourceExecutor);
registerExecutor(matchesExecutor);
registerExecutor(llmJudgeExecutor);

// ── Workspace helpers ─────────────────────────────────────────────────────────

/**
 * Directories excluded from grading and scoring — these contain injected context
 * (skill files, scaffold metadata) that would contaminate results if included.
 * Shared by graders.ts (collectFiles) and scorer.ts (walkFiles).
 */
export const EXCLUDED_EVAL_DIRS = new Set([
  // Agent specific directories
  '.claude',
  '.github',
  '.gemini',
  // Npm directory
  'node_modules',
  // Build output directories
  'dist',
  '.next',
  '.nuxt',
  '.output',
  '.build',
  '.angular',
  'out-tsc',
]);
export const EXCLUDED_EVAL_FILES = new Set(['package-lock.json', 'tsconfig.tsbuildinfo']);

export function collectFiles(workspace: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const relPath of collectFilePaths(workspace, workspace)) {
    if (relPath.startsWith('…')) continue; // skip truncation notice
    if (EXCLUDED_EVAL_FILES.has(relPath)) continue;
    if ([...EXCLUDED_EVAL_DIRS].some((dir) => relPath.startsWith(dir + '/'))) continue;
    try {
      files[relPath] = readFileSync(join(workspace, relPath), 'utf-8');
    } catch {
      // skip unreadable files
    }
  }
  return files;
}

/**
 * Recursively yields absolute file paths under `dir`, respecting exclusion sets.
 * Used by the scorer for hallucination and security scanning.
 */
export function* walkFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_EVAL_DIRS.has(entry.name)) {
        yield* walkFiles(full);
      }
    } else if (!EXCLUDED_EVAL_FILES.has(entry.name)) {
      yield full;
    }
  }
}

function combined(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([k, v]) => `// FILE: ${k}\n${v}`)
    .join('\n\n');
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runGraders(
  graderDefs: GraderDef[],
  workspace: string,
  apiKey: string,
  judgeModel?: string,
  allowedLevels?: Set<GraderLevel>,
  enforceMaxChars: boolean = true,
): Promise<GraderResult[]> {
  const config = getFrameworkConfig();
  const resolvedJudgeModel = judgeModel ?? config.judge.model ?? '';
  const judgeMaxCodeChars = config.judge.maxCodeChars ?? 16_384;
  const judgeMaxTokens = config.judge.maxTokens ?? 1024;
  const judgeBaseUrl = config.proxy.baseUrl;
  const judgePromptsDir = config.judge.promptsDir;
  const judgeModelMap = getLitellmModelMap();
  const active = allowedLevels
    ? graderDefs.filter((g) => g.level === undefined || allowedLevels.has(g.level))
    : graderDefs;

  const files = collectFiles(workspace);
  const combinedText = combined(files);
  const combinedLower = combinedText.toLowerCase();

  const context = {
    workspace,
    files,
    combinedText,
    combinedLower,
    apiKey,
    judge: {
      model: resolvedJudgeModel,
      baseUrl: judgeBaseUrl,
      maxTokens: judgeMaxTokens,
      maxCodeChars: judgeMaxCodeChars,
      promptsDir: judgePromptsDir,
      modelMap: judgeModelMap,
      enforceMaxChars,
    },
  };

  const results: GraderResult[] = [];
  for (const g of active) {
    try {
      results.push(await executeGrader(g, context));
    } catch (err) {
      results.push({
        name: g.name,
        kind: g.kind,
        passed: false,
        detail: `Grader error [${g.name}/${g.kind}]: ${err instanceof Error ? err.message : String(err)}`,
        level: g.level,
      });
    }
  }

  return results;
}

// ── Summary helpers ───────────────────────────────────────────────────────────

export function passRate(results: GraderResult[]): number {
  if (!results.length) return 0.0;
  return results.filter((r) => r.passed).length / results.length;
}
