/**
 * Eval auto-discovery — scans evalsDir for directories containing
 * PROMPT.md + graders.ts and builds EvalConfig[] from frontmatter.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { EvalConfigError } from './errors.js';
import { logger } from './utils/logger.js';
import { parseFrontmatter } from './utils/frontmatter.js';
import type { EvalConfig } from './loader.js';

/**
 * Recursively discovers eval directories under {@link evalsDir}.
 *
 * A directory is an eval if it contains both `PROMPT.md` and `graders.ts`.
 * The eval `id` is read from `PROMPT.md` frontmatter (`id: …`).
 * `name` and `category` are optional — `name` defaults to `id`,
 * `category` defaults to the parent directory name.
 *
 * @param evalsDir - Relative path to the evals directory (e.g. `'src/evals'`).
 * @param frameworkRoot - Absolute path to the project root.
 * @returns Discovered eval configs, sorted by `id`.
 * @throws {EvalConfigError} When `evalsDir` does not exist or is not a directory.
 */
export function discoverEvals(evalsDir: string, frameworkRoot: string): EvalConfig[] {
  const absEvalsDir = join(frameworkRoot, evalsDir);
  if (!existsSync(absEvalsDir) || !statSync(absEvalsDir).isDirectory()) {
    throw new EvalConfigError(`evalsDir not found or not a directory: ${absEvalsDir}`, absEvalsDir);
  }

  const results: EvalConfig[] = [];
  findEvalDirs(absEvalsDir, frameworkRoot, results, 0);

  // Validate no duplicate IDs
  const seen = new Map<string, string>();
  for (const cfg of results) {
    const existing = seen.get(cfg.id);
    if (existing) {
      throw new EvalConfigError(
        `Duplicate eval id '${cfg.id}' in ${cfg.path} and ${existing}`,
        join(frameworkRoot, cfg.path, 'PROMPT.md'),
      );
    }
    seen.set(cfg.id, cfg.path);
  }

  results.sort((a, b) => a.id.localeCompare(b.id));

  logger.info(`[Discovery] Found ${results.length} eval(s) in ${evalsDir}`);
  return results;
}

/** Maximum directory depth to search below evalsDir. */
const MAX_DEPTH = 3;

/**
 * Recursively walks directories looking for eval dirs (containing PROMPT.md + graders.ts).
 * Stops at {@link MAX_DEPTH} levels below evalsDir.
 */
function findEvalDirs(dir: string, frameworkRoot: string, results: EvalConfig[], depth: number): void {
  const promptPath = join(dir, 'PROMPT.md');
  const gradersPath = join(dir, 'graders.ts');

  if (existsSync(promptPath) && existsSync(gradersPath)) {
    results.push(buildEvalConfig(promptPath, dir, frameworkRoot));
    // Don't recurse into eval dirs — they shouldn't contain nested evals
    return;
  }

  if (depth >= MAX_DEPTH) return;

  // Recurse into subdirectories
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      entry.name !== 'node_modules' &&
      entry.name !== 'scaffold'
    ) {
      findEvalDirs(join(dir, entry.name), frameworkRoot, results, depth + 1);
    }
  }
}

/**
 * Builds an EvalConfig from a discovered PROMPT.md file's frontmatter.
 */
function buildEvalConfig(promptPath: string, evalDir: string, frameworkRoot: string): EvalConfig {
  const text = readFileSync(promptPath, 'utf-8');
  const { meta } = parseFrontmatter(text);
  const relPath = relative(frameworkRoot, evalDir);

  if (!meta.id) {
    throw new EvalConfigError(`PROMPT.md missing or empty 'id' in frontmatter`, join(evalDir, 'PROMPT.md'));
  }

  const SAFE_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
  if (!SAFE_ID_RE.test(meta.id)) {
    throw new EvalConfigError(`Invalid eval id '${meta.id}': must match ${SAFE_ID_RE}`, join(evalDir, 'PROMPT.md'));
  }

  const parentDir = basename(join(evalDir, '..'));
  const category = meta.category || parentDir;
  const name = meta.name || meta.id;

  return {
    id: meta.id,
    name,
    category,
    path: relPath,
  };
}
