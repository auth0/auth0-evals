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

  // system_default.md is always the agent system prompt — it contains the universal
  // identity, 8-step workflow, tool guidance, and behavior rules. Individual evals
  // do not override this; framework-specific hints belong in the ## Task section.
  const srcDefaultPath = join(frameworkRoot, 'src', 'prompts', 'system_default.md');
  const distDefaultPath = join(frameworkRoot, 'prompts', 'system_default.md');
  const defaultPath = existsSync(srcDefaultPath) ? srcDefaultPath : distDefaultPath;
  const agentSystemPrompt = existsSync(defaultPath) ? readFileSync(defaultPath, 'utf-8').trim() : '';

  const distRelPath = evalConfig.path.replace(/^src\//, '');
  const distGradersPath = join(frameworkRoot, 'dist', distRelPath, 'graders.js');
  const srcGradersPath = join(evalPath, 'graders.ts');
  const gradersPath = existsSync(distGradersPath) ? distGradersPath : srcGradersPath;
  const graders = await loadGraders(gradersPath);
  const scaffold = loadScaffold(join(evalPath, 'scaffold'));

  const skillsRaw = meta.skills ?? '';
  const skills = skillsRaw
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  const setupCommand = meta.setup_command || undefined;

  return {
    id: evalConfig.id,
    name: evalConfig.name ?? meta.name ?? evalConfig.id,
    category: evalConfig.category ?? meta.category ?? '',
    path: evalPath,
    baselineSystemPrompt,
    userPrompt,
    agentSystemPrompt,
    graders,
    scaffold,
    setupCommand,
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
  agentSystemPrompt: string;
  meta: Record<string, string>;
} {
  if (!existsSync(promptPath)) {
    throw new EvalConfigError('PROMPT.md not found', promptPath);
  }

  let text = readFileSync(promptPath, 'utf-8').replace(/\r\n/g, '\n');

  // Extract YAML-ish frontmatter between --- delimiters
  const meta: Record<string, string> = {};
  const frontMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontMatch && frontMatch[1]) {
    for (const line of frontMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const k = line.slice(0, colonIdx).trim();
        const v = line.slice(colonIdx + 1).trim();
        meta[k] = v;
      }
    }
    if (frontMatch[0]) {
      text = text.slice(frontMatch[0].length);
    }
  }

  const systemMatch = text.match(/^## System\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const agentSystemMatch = text.match(/^## Agent System\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const taskMatch = text.match(/^## Task\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);

  const baselineSystemPrompt = systemMatch?.[1] ? systemMatch[1].trim() : defaultBaselinePrompt;
  const agentSystemPrompt = agentSystemMatch?.[1] ? agentSystemMatch[1].trim() : '';
  const userPrompt = taskMatch?.[1] ? taskMatch[1].trim() : text.trim();

  return { baselineSystemPrompt, userPrompt, agentSystemPrompt, meta };
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

// ── scaffold loader ───────────────────────────────────────────────────────────

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
      try {
        files[rel] = readFileSync(fullPath, 'utf-8');
      } catch {
        // skip unreadable files
      }
    }
  }
}
