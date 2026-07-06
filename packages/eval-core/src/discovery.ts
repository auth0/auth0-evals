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
 * Recursively walks directories looking for eval dirs (PROMPT.md + graders.ts).
 * Stops at {@link MAX_DEPTH} levels below evalsDir.
 */
function findEvalDirs(dir: string, frameworkRoot: string, results: EvalConfig[], depth: number): void {
  const gradersPath = join(dir, 'graders.ts');
  const defaultPrompt = join(dir, 'PROMPT.md');

  if (existsSync(gradersPath) && existsSync(defaultPrompt)) {
    results.push(...buildEvalConfigs(defaultPrompt, dir, frameworkRoot));
    return;
  }

  if (depth >= MAX_DEPTH) return;

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

/** Allowed tenant-config methods (must stay in sync with eval-graders TenantConfigMethod). */
const TENANT_CONFIG_METHODS = ['terraform', 'cli'] as const;
type TenantConfigMethod = (typeof TENANT_CONFIG_METHODS)[number];

/**
 * Builds one or more EvalConfigs from a PROMPT.md's frontmatter.
 * When `tenant_config_methods` is present, fans out one config per method.
 */
function buildEvalConfigs(promptPath: string, evalDir: string, frameworkRoot: string): EvalConfig[] {
  const text = readFileSync(promptPath, 'utf-8');
  const { meta } = parseFrontmatter(text);
  const relPath = relative(frameworkRoot, evalDir);

  if (!meta.id) {
    throw new EvalConfigError(`PROMPT.md missing or empty 'id' in frontmatter`, promptPath);
  }

  const SAFE_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
  if (!SAFE_ID_RE.test(meta.id)) {
    throw new EvalConfigError(`Invalid eval id '${meta.id}': must match ${SAFE_ID_RE}`, promptPath);
  }

  const parentDir = basename(join(evalDir, '..'));
  const category = meta.category || parentDir;
  const baseName = meta.name || meta.id;

  const methodsRaw = (meta.tenant_config_methods || '').trim();
  if (!methodsRaw) {
    return [{ id: meta.id, name: baseName, category, path: relPath }];
  }

  const methods = methodsRaw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  return methods.map((method) => {
    if (!(TENANT_CONFIG_METHODS as readonly string[]).includes(method)) {
      throw new EvalConfigError(
        `Invalid tenant_config_methods entry '${method}': must be one of ${TENANT_CONFIG_METHODS.join(', ')}`,
        promptPath,
      );
    }
    const scaffold = meta[`scaffold_${method}`];
    if (!scaffold) {
      throw new EvalConfigError(`Missing 'scaffold_${method}' for tenant_config_methods entry '${method}'`, promptPath);
    }
    return {
      id: `${meta.id}_${method}`,
      name: baseName,
      category,
      path: relPath,
      tenantConfigMethod: method as TenantConfigMethod,
      variantScaffold: scaffold,
    };
  });
}
