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
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, EXCLUDED_DIRS, JUDGE_MAX_TOKENS, JUDGE_MODEL } from '../config/settings.js';
import { LlmApiError } from '../errors.js';
import { withRetry } from '../utils/retry.js';

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

// ── Result type ───────────────────────────────────────────────────────────────

export interface GraderResult {
  name: string;
  kind: string;
  passed: boolean;
  detail: string;
}

// ── Workspace helpers ─────────────────────────────────────────────────────────

export function collectFiles(workspace: string): Record<string, string> {
  const files: Record<string, string> = {};
  walkDir(workspace, workspace, files);
  return files;
}

function walkDir(dir: string, root: string, files: Record<string, string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, root, files);
    } else if (entry.isFile()) {
      try {
        files[relative(root, fullPath)] = readFileSync(fullPath, 'utf-8');
      } catch {
        // skip
      }
    }
  }
}

function combined(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([k, v]) => `// FILE: ${k}\n${v}`)
    .join('\n\n');
}

// ── Grader factories ──────────────────────────────────────────────────────────

export function contains(needle: string, description?: string): GraderDef {
  return {
    kind: 'contains',
    needle,
    name: description ?? `contains '${needle}'`,
  };
}

export function notContains(needle: string, description?: string): GraderDef {
  return {
    kind: 'not_contains',
    needle,
    name: description ?? `not_contains '${needle}'`,
  };
}

export function matches(pattern: string, description?: string): GraderDef {
  return {
    kind: 'matches',
    pattern,
    name: description ?? `matches /${pattern}/`,
  };
}

export function notContainsInSource(needle: string, description?: string): GraderDef {
  return {
    kind: 'not_contains_in_source',
    needle,
    name: description ?? `not_contains_in_source '${needle}'`,
  };
}

export function judge(question: string, framework?: string): GraderDef {
  return {
    kind: 'judge',
    question,
    framework,
    name: question.slice(0, 80),
  };
}

export interface GraderDef {
  kind: string;
  name: string;
  needle?: string;
  pattern?: string;
  question?: string;
  framework?: string;
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runGraders(
  graderDefs: GraderDef[],
  workspace: string,
  apiKey: string,
  judgeModel: string = JUDGE_MODEL,
): Promise<GraderResult[]> {
  const files = collectFiles(workspace);
  const combinedText = combined(files);
  const combinedLower = combinedText.toLowerCase();
  const results: GraderResult[] = [];

  for (const g of graderDefs) {
    const { kind, name } = g;

    if (kind === 'contains') {
      const needle = g.needle!;
      const passed = combinedLower.includes(needle.toLowerCase());
      results.push({
        name,
        kind,
        passed,
        detail: `'${needle}' ${passed ? 'found' : 'NOT found'} in written files`,
      });
    } else if (kind === 'not_contains') {
      const needle = g.needle!;
      const passed = !combinedLower.includes(needle.toLowerCase());
      results.push({
        name,
        kind,
        passed,
        detail: `'${needle}' ${passed ? 'NOT found (good)' : 'FOUND (bad)'} in written files`,
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
      results.push({ name, kind, passed, detail });
    } else if (kind === 'judge') {
      const { passed, detail } = await llmJudge(g.question!, combinedText, apiKey, judgeModel, g.framework);
      results.push({ name, kind, passed, detail });
    } else {
      results.push({ name, kind, passed: false, detail: `Unknown grader kind: ${kind}` });
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
): Promise<{ passed: boolean; detail: string }> {
  const base = loadFrameworkPrompt(framework);
  const system =
    `${base} Reply with 'yes' or 'no' on the first line, ` +
    'then a brief explanation of your reasoning on the following lines.';
  const user = loadUserTemplate().replace('{question}', question).replace('{code}', code.slice(0, 6000));

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
      return { passed: false, detail: `Judge (${model}) error: empty response` };
    }
    const firstLine = answer.split('\n')[0]!.toLowerCase();
    const m = /^(yes|no)\b/.exec(firstLine);
    if (!m) {
      return {
        passed: false,
        detail: `Judge (${model}) error: unexpected verdict ${JSON.stringify(firstLine)}: ${answer}`,
      };
    }
    return { passed: m[1] === 'yes', detail: `Judge (${model}): ${answer}` };
  } catch (e) {
    return { passed: false, detail: `Judge (${model}) error: ${e}` };
  }
}

// ── Summary helpers ───────────────────────────────────────────────────────────

export function passRate(results: GraderResult[]): number {
  if (!results.length) return 1.0;
  return results.filter((r) => r.passed).length / results.length;
}
