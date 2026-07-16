/**
 * Eval loader — reads a self-contained eval directory.
 *
 * Each eval directory contains:
 *   PROMPT.md   — frontmatter metadata + ## System and ## Task sections
 *   graders.ts  — defineGraders() returning a list of grader dicts
 *   scaffold/   — (optional) starter files written to the agent workspace
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvalConfigError, EvalNotFoundError } from './errors.js';
import { logger } from './utils/logger.js';
import { parseFrontmatter } from './utils/frontmatter.js';
import { resolveInside } from './workspace/path-utils.js';
import type { EvalDefinition, GraderDef } from './types/eval.js';

export { EvalDefinition, GraderDef } from './types/eval.js';

/** Minimal eval registration entry — the config ID, display name, category, and path. */
export interface EvalConfig {
  id: string;
  name: string;
  category: string;
  path: string;
}

/** Options for customising how the loader parses PROMPT.md. */
export interface LoadEvalOptions {
  /** Default baseline system prompt when no `## System` section is found. */
  defaultBaselineSystemPrompt?: string;
}

const FALLBACK_BASELINE_PROMPT =
  'Always prefer the official Auth0 SDK for the target framework. Do not use generic or third-party alternatives when an official Auth0 package exists.';

export async function loadEval(
  evalConfig: EvalConfig,
  frameworkRoot: string,
  options?: LoadEvalOptions,
): Promise<EvalDefinition> {
  const evalPath = join(frameworkRoot, evalConfig.path);
  if (!existsSync(evalPath) || !statSync(evalPath).isDirectory()) {
    throw new EvalNotFoundError(evalConfig.id);
  }

  const defaultBaselinePrompt = options?.defaultBaselineSystemPrompt ?? FALLBACK_BASELINE_PROMPT;
  const { baselineSystemPrompt, userPrompt, meta } = parsePromptMd(join(evalPath, 'PROMPT.md'), defaultBaselinePrompt);

  const distRelPath = evalConfig.path.replace(/^src\//, '');
  const distGradersPath = join(frameworkRoot, 'dist', distRelPath, 'graders.js');
  const srcGradersPath = join(evalPath, 'graders.ts');
  const gradersPath = existsSync(distGradersPath) ? distGradersPath : srcGradersPath;
  const graders = await loadGraders(gradersPath);
  const scaffoldDir = resolveScaffoldFromMeta(meta.scaffold, evalPath, frameworkRoot);
  const scaffold = loadScaffold(scaffoldDir);

  const skillsRaw = meta.skills ?? '';
  const skills = skillsRaw
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  const setupCommand = meta.setup_command || undefined;
  const compileCommand = meta.compile_command || undefined;

  return {
    id: evalConfig.id,
    name: evalConfig.name ?? meta.name ?? evalConfig.id,
    category: evalConfig.category ?? meta.category ?? '',
    path: evalPath,
    baselineSystemPrompt,
    userPrompt,
    graders,
    scaffold,
    setupCommand,
    compileCommand,
    skills,
    metadata: {
      provider_name: meta.provider_name ?? 'Auth0',
      provider_url: meta.provider_url ?? 'auth0.com',
      category: evalConfig.category ?? '',
      task_description: meta.task_description ?? evalConfig.name ?? '',
    },
  };
}

// ── PROMPT.md parser ──────────────────────────────────────────────────────────

function parsePromptMd(
  promptPath: string,
  defaultBaselinePrompt: string,
): {
  baselineSystemPrompt: string;
  userPrompt: string;
  meta: Record<string, string>;
} {
  if (!existsSync(promptPath)) {
    throw new EvalConfigError('PROMPT.md not found', promptPath);
  }

  const raw = readFileSync(promptPath, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);

  const systemMatch = body.match(/^## System\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const taskMatch = body.match(/^## Task\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);

  const baselineSystemPrompt = systemMatch?.[1] ? systemMatch[1].trim() : defaultBaselinePrompt;
  const userPrompt = taskMatch?.[1] ? taskMatch[1].trim() : body.trim();

  return { baselineSystemPrompt, userPrompt, meta };
}

// ── graders.ts dynamic import ─────────────────────────────────────────────────

async function loadGraders(gradersPath: string): Promise<GraderDef[]> {
  if (!existsSync(gradersPath)) {
    throw new EvalConfigError('graders file not found', gradersPath);
  }

  const mod = await import(pathToFileURL(gradersPath).href);
  if (typeof mod.defineGraders !== 'function') {
    throw new EvalConfigError('graders.ts missing defineGraders()', gradersPath);
  }

  return mod.defineGraders();
}

// ── scaffold resolution ───────────────────────────────────────────────────────

/**
 * Resolve the scaffold directory from the optional `scaffold` frontmatter field.
 * Falls back to the local scaffold/ subdirectory when the field is absent.
 */
function resolveScaffoldFromMeta(scaffoldMeta: string | undefined, evalPath: string, frameworkRoot: string): string {
  if (!scaffoldMeta) {
    return join(evalPath, 'scaffold');
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveInside(frameworkRoot, scaffoldMeta);
  } catch {
    throw new EvalConfigError(
      `scaffold path is invalid or escapes project root: ${scaffoldMeta}`,
      join(evalPath, 'PROMPT.md'),
    );
  }

  if (!existsSync(resolvedPath)) {
    throw new EvalConfigError(`scaffold path does not exist: ${resolvedPath}`, join(evalPath, 'PROMPT.md'));
  }

  return resolvedPath;
}

// ── scaffold file loader ──────────────────────────────────────────────────────

function loadScaffold(scaffoldDir: string): Record<string, string> {
  if (!existsSync(scaffoldDir) || !statSync(scaffoldDir).isDirectory()) {
    return {};
  }

  const files: Record<string, string> = {};
  walkDir(scaffoldDir, scaffoldDir, files);
  return files;
}

function walkDir(dir: string, root: string, files: Record<string, string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, root, files);
    } else if (entry.isFile()) {
      const rel = relative(root, fullPath);
      let safePath: string;
      try {
        safePath = resolveInside(root, rel);
      } catch (e) {
        logger.warn(
          `[Loader] Skipping scaffold file due to path validation: ${rel} (${e instanceof Error ? e.message : 'unknown error'})`,
        );
        continue;
      }
      try {
        files[rel] = readFileSync(safePath, 'utf-8');
      } catch (e) {
        logger.warn(
          `[Loader] Skipping unreadable scaffold file: ${rel} (${e instanceof Error ? e.message : 'unknown error'})`,
        );
      }
    }
  }
}
