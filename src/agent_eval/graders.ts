/**
 * Grader primitives.
 *
 * Each eval task defines a list of graders. After the agent finishes,
 * runGraders() evaluates all written files against them and returns
 * pass/fail per grader.
 *
 * Primitives:
 *   contains(needle)          — substring present in any written file
 *   notContains(needle)       — substring must NOT appear in any written file
 *   matches(pattern)          — regex match in any written file
 *   judge(question, framework) — LLM-as-judge yes/no question about the code
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, JUDGE_MAX_CODE_CHARS, JUDGE_MAX_TOKENS, JUDGE_MODEL } from '../config/settings.js';
import { JudgeError, LlmApiError } from '../errors.js';
import { collectFiles as collectFilePaths } from './tools/utils.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

function resolveProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not find project root (no package.json found)');
}

const JUDGE_PROMPTS_DIR = join(resolveProjectRoot(), 'src', 'prompts', 'judge');

function loadFrameworkPrompt(framework?: string): string {
  const name = framework && existsSync(join(JUDGE_PROMPTS_DIR, `${framework}.md`)) ? framework : 'default';
  return readFileSync(join(JUDGE_PROMPTS_DIR, `${name}.md`), 'utf-8').trim();
}

function loadUserTemplate(): string {
  return readFileSync(join(JUDGE_PROMPTS_DIR, 'user_template.md'), 'utf-8').trim();
}

// ── Level enum ────────────────────────────────────────────────────────────────

export enum GraderLevel {
  L1 = 'positive_presence',
  L2 = 'hallucination',
  L3 = 'security',
  L4 = 'structural',
  L5 = 'version_correctness',
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface GraderResult {
  name: string;
  kind: string;
  passed: boolean;
  detail: string;
  level?: GraderLevel;
}

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
  'out-tsc'
]);
export const EXCLUDED_EVAL_FILES = new Set(['package-lock.json']);

/** File patterns excluded from the LLM judge input to save token budget. */
const JUDGE_EXCLUDED_PATTERNS = [/^tsconfig(\.\w+)?\.json$/, /^angular\.json$/];

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

// ── Grader factories ──────────────────────────────────────────────────────────

export function contains(needle: string, description?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'contains',
    needle,
    name: description ?? `contains '${needle}'`,
    level,
  };
}

export function notContains(needle: string, description?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'not_contains',
    needle,
    name: description ?? `not_contains '${needle}'`,
    level,
  };
}

export function matches(pattern: string, description?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'matches',
    pattern,
    name: description ?? `matches /${pattern}/`,
    level,
  };
}

export function notContainsInSource(needle: string, description?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'not_contains_in_source',
    needle,
    name: description ?? `not_contains_in_source '${needle}'`,
    level,
  };
}

export function judge(question: string, framework?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'judge',
    question,
    framework,
    name: question.slice(0, 80),
    level,
  };
}

export interface GraderDef {
  kind: string;
  name: string;
  needle?: string;
  pattern?: string;
  question?: string;
  framework?: string;
  level?: GraderLevel;
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runGraders(
  graderDefs: GraderDef[],
  workspace: string,
  apiKey: string,
  judgeModel: string = JUDGE_MODEL,
  allowedLevels?: Set<GraderLevel>,
  enforceMaxChars: boolean = true,
): Promise<GraderResult[]> {
  const active = allowedLevels
    ? graderDefs.filter((g) => g.level === undefined || allowedLevels.has(g.level))
    : graderDefs;

  const files = collectFiles(workspace);
  const combinedText = combined(files);
  const combinedLower = combinedText.toLowerCase();
  const results: GraderResult[] = [];

  for (const g of active) {
    const { kind, name } = g;

    if (kind === 'contains') {
      const needle = g.needle!;
      const passed = combinedLower.includes(needle.toLowerCase());
      results.push({
        name,
        kind,
        passed,
        detail: `'${needle}' ${passed ? 'found' : 'NOT found'} in written files`,
        level: g.level,
      });
    } else if (kind === 'not_contains') {
      const needle = g.needle!;
      const passed = !combinedLower.includes(needle.toLowerCase());
      results.push({
        name,
        kind,
        passed,
        detail: `'${needle}' ${passed ? 'NOT found (good)' : 'FOUND (bad)'} in written files`,
        level: g.level,
      });
    } else if (kind === 'not_contains_in_source') {
      const needle = g.needle!;
      const needleLower = needle.toLowerCase();
      // Only check source files — exclude .env*, .json, .plist, config-only files
      const NON_SOURCE_EXTS = /\.(env|json|plist|xml|yaml|yml|toml|ini|cfg|conf)$/i;
      const NON_SOURCE_PREFIXES = /^\.env/;
      let found = false;
      for (const [filePath, content] of Object.entries(files)) {
        const base = filePath.split('/').pop() ?? filePath;
        if (NON_SOURCE_EXTS.test(base) || NON_SOURCE_PREFIXES.test(base)) continue;
        if (content.toLowerCase().includes(needleLower)) {
          found = true;
          break;
        }
      }
      results.push({
        name,
        kind,
        passed: !found,
        detail: `'${needle}' ${!found ? 'NOT found in source files (good)' : 'FOUND in source files (bad)'}`,
        level: g.level,
      });
    } else if (kind === 'matches') {
      const pattern = g.pattern!;
      let passed: boolean;
      let detail: string;
      try {
        passed = new RegExp(pattern, 'im').test(combinedText);
        detail = `/${pattern}/ ${passed ? 'matched' : 'NOT matched'}`;
      } catch (e) {
        passed = false;
        detail = `/(invalid regex: ${e})/ NOT matched`;
      }
      results.push({ name, kind, passed, detail, level: g.level });
    } else if (kind === 'judge') {
      const judgeEntries = Object.entries(files)
        .filter(([k]) => !JUDGE_EXCLUDED_PATTERNS.some((p) => p.test(k.split('/').pop()!)));
      const judgeText = judgeEntries
        .map(([k, v]) => `// FILE: ${k}\n${v}`)
        .join('\n\n');
      logger.info(`[judge] ${judgeEntries.length} files, ${judgeText.length} chars total (limit: ${JUDGE_MAX_CODE_CHARS})`);
      for (const [k, v] of judgeEntries) {
        logger.info(`[judge]   ${k} (${v.length} chars)`);
      }
      if (judgeText.length > JUDGE_MAX_CODE_CHARS) {
        logger.warn(`[judge] WARNING: content exceeds limit (${judgeText.length} > ${JUDGE_MAX_CODE_CHARS} chars)`);
      }
      const { passed, detail } = await llmJudge(g.question!, judgeText, apiKey, judgeModel, g.framework, enforceMaxChars);
      results.push({ name, kind, passed, detail, level: g.level });
    } else {
      results.push({ name, kind, passed: false, detail: `Unknown grader kind: ${kind}`, level: g.level });
    }
  }

  return results;
}

export async function llmJudge(
  question: string,
  code: string,
  apiKey: string,
  model: string,
  framework?: string,
  enforceMaxChars: boolean = true,
): Promise<{ passed: boolean; detail: string }> {
  const base = loadFrameworkPrompt(framework);
  const system =
    `${base} Provide 1-3 short sentences of reasoning, ` +
    "then on the FINAL line write your verdict as exactly 'yes' or 'no' (nothing else on that line).";
  if (code.length > JUDGE_MAX_CODE_CHARS) {
    if (enforceMaxChars) {
      throw new Error(
        `[judge] Code corpus exceeds limit: ${code.length} chars > ${JUDGE_MAX_CODE_CHARS}. ` +
          `Increase JUDGE_MAX_CODE_CHARS or reduce the number or size of files being judged.`,
      );
    }
    logger.warn(
      `[judge] Code corpus exceeds limit (${code.length} > ${JUDGE_MAX_CODE_CHARS} chars) — proceeding anyway`,
    );
  }
  const user = loadUserTemplate().replace('{question}', question).replace('{code}', code);

  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.0,
    max_tokens: JUDGE_MAX_TOKENS,
  });

  try {
    const data = await withRetry(async () => {
      const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new LlmApiError(resp.status, body);
      }

      return (await resp.json()) as Record<string, unknown>;
    });
    const choices = data.choices as Record<string, unknown>[] | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const answer = ((message?.content as string | undefined) ?? '').trim();
    if (!answer) {
      throw new JudgeError(model, 'empty response from LLM');
    }
    const lines = answer
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const lastLine = lines[lines.length - 1]!.toLowerCase();
    const m = /^(yes|no)\b/.exec(lastLine);
    if (!m) {
      throw new JudgeError(model, `unexpected verdict ${JSON.stringify(lastLine)}: ${answer}`);
    }
    return { passed: m[1] === 'yes', detail: `Judge (${model}): ${answer}` };
  } catch (e) {
    if (e instanceof JudgeError) throw e;
    throw new JudgeError(model, String(e));
  }
}

// ── Summary helpers ───────────────────────────────────────────────────────────

export function passRate(results: GraderResult[]): number {
  if (!results.length) return 0.0;
  return results.filter((r) => r.passed).length / results.length;
}
