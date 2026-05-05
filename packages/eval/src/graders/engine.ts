/**
 * Grader execution engine.
 *
 * Primitives (contains, notContains, matches, etc.) and types (GraderDef,
 * GraderResult, GraderLevel) are defined in @a0/eval-graders.
 * This file provides the execution engine that evaluates graders against
 * workspace files and runs the LLM judge.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getLitellmModelMap } from '../config/settings.js';
import { getFrameworkConfig } from '../config/framework-config.js';
import { JudgeError, LlmApiError } from '../errors.js';
import { collectFiles as collectFilePaths } from '../workspace/index.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import type { GraderDef, GraderResult } from '@a0/eval-graders';
import { GraderLevel } from '@a0/eval-graders';
import { FRAMEWORK_PROMPTS, USER_TEMPLATE } from './prompts.generated.js';

// ── Prompt loading ────────────────────────────────────────────────────────────

function loadFrameworkPrompt(framework?: string): string {
  const config = getFrameworkConfig();
  const dir = config.judge.promptsDir;

  // Custom prompts directory configured — load from disk.
  // Relative paths are resolved against cwd (the project root at runtime).
  if (dir) {
    const resolved = resolve(dir);
    const name = framework && existsSync(join(resolved, `${framework}.md`)) ? framework : 'default';
    return readFileSync(join(resolved, `${name}.md`), 'utf-8').trim();
  }

  // Built-in prompts generated from src/graders/prompts/*.md at build time.
  const prompt = framework ? FRAMEWORK_PROMPTS[framework] : undefined;
  return prompt ?? FRAMEWORK_PROMPTS['default']!;
}

function loadUserTemplate(): string {
  const config = getFrameworkConfig();
  const dir = config.judge.promptsDir;

  if (dir) {
    return readFileSync(join(resolve(dir), 'user_template.md'), 'utf-8').trim();
  }

  return USER_TEMPLATE;
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
  'out-tsc',
]);
export const EXCLUDED_EVAL_FILES = new Set(['package-lock.json', 'tsconfig.tsbuildinfo']);

/** File patterns excluded from the LLM judge input to save token budget. */
const JUDGE_EXCLUDED_PATTERNS = [/^tsconfig(\.\w+)?\.json$/, /^angular\.json$/, /^tsconfig\.tsbuildinfo$/];

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
      const passed =
        (g.caseSensitive ?? true) ? combinedText.includes(needle) : combinedLower.includes(needle.toLowerCase());
      results.push({
        name,
        kind,
        passed,
        detail: `'${needle}' ${passed ? 'found' : 'NOT found'} in written files`,
        level: g.level,
      });
    } else if (kind === 'not_contains') {
      const needle = g.needle!;
      const passed =
        (g.caseSensitive ?? true) ? !combinedText.includes(needle) : !combinedLower.includes(needle.toLowerCase());
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
        const hit = (g.caseSensitive ?? true) ? content.includes(needle) : content.toLowerCase().includes(needleLower);
        if (hit) {
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
      const judgeEntries = Object.entries(files).filter(
        ([k]) => !JUDGE_EXCLUDED_PATTERNS.some((p) => p.test(k.split('/').pop()!)),
      );
      const judgeText = judgeEntries.map(([k, v]) => `// FILE: ${k}\n${v}`).join('\n\n');
      logger.info(
        `[judge] ${judgeEntries.length} files, ${judgeText.length} chars total (limit: ${judgeMaxCodeChars})`,
      );
      for (const [k, v] of judgeEntries) {
        logger.info(`[judge]   ${k} (${v.length} chars)`);
      }
      if (judgeText.length > judgeMaxCodeChars) {
        logger.warn(`[judge] WARNING: content exceeds limit (${judgeText.length} > ${judgeMaxCodeChars} chars)`);
      }
      const { passed, detail } = await llmJudge(
        g.question!,
        judgeText,
        apiKey,
        resolvedJudgeModel,
        g.framework,
        enforceMaxChars,
      );
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
  const config = getFrameworkConfig();
  const judgeMaxCodeChars = config.judge.maxCodeChars ?? 16_384;
  const judgeMaxTokens = config.judge.maxTokens ?? 1024;
  const baseUrl = config.proxy.baseUrl;

  if (!model) {
    throw new JudgeError('(none)', 'No judge model configured. Set judge.model in eval.config.js or pass judgeModel.');
  }
  if (!baseUrl) {
    throw new JudgeError(model, 'No proxy base URL configured. Set proxy.baseUrl in eval.config.js.');
  }

  const base = loadFrameworkPrompt(framework);
  const system =
    `${base} Provide 1-3 short sentences of reasoning, ` +
    "then on the FINAL line write your verdict as exactly 'yes' or 'no' (nothing else on that line).";
  if (code.length > judgeMaxCodeChars) {
    if (enforceMaxChars) {
      throw new Error(
        `[judge] Code corpus exceeds limit: ${code.length} chars > ${judgeMaxCodeChars}. ` +
          `Increase judge.maxCodeChars or reduce the number or size of files being judged.`,
      );
    }
    logger.warn(`[judge] Code corpus exceeds limit (${code.length} > ${judgeMaxCodeChars} chars) — proceeding anyway`);
  }
  const user = loadUserTemplate().replace('{question}', question).replace('{code}', code);
  const apiModel = getLitellmModelMap()[model] ?? model;

  const payload = JSON.stringify({
    model: apiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.0,
    max_tokens: judgeMaxTokens,
  });

  try {
    const data = await withRetry(async () => {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
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
