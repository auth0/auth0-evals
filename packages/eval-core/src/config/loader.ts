/**
 * Config file loader — auto-discovers `eval.config.js` from cwd
 * (like vite.config.js) and deep-merges with defaults.
 */

import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvalConfigError } from '../errors.js';
import type { FrameworkConfig } from './framework.js';
import { DEFAULT_FRAMEWORK_CONFIG } from './defaults.js';

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * Identity function that provides type inference for `eval.config.js` files.
 *
 * ```js
 * // eval.config.js
 * import { defineConfig } from '@a0/eval';
 * export default defineConfig({ evalsDir: 'src/evals' });
 * ```
 */
export function defineConfig(config: Partial<FrameworkConfig>): Partial<FrameworkConfig> {
  return config;
}

// ── Config loading ───────────────────────────────────────────────────────────

export interface LoadConfigOptions {
  /** Explicit path to the config file. Skips auto-discovery when provided. */
  configPath?: string;
  /** Directory to search for `eval.config.js`. Defaults to `process.cwd()`. */
  searchDir?: string;
}

const CONFIG_FILE_NAMES = ['eval.config.js', 'eval.config.mjs'];

/**
 * Loads and validates a {@link FrameworkConfig}.
 *
 * 1. If `configPath` is provided, loads that file directly.
 * 2. Otherwise, searches `searchDir` (default: cwd) for `eval.config.js`.
 * 3. Deep-merges the user config with {@link DEFAULT_FRAMEWORK_CONFIG}.
 * 4. Validates required fields.
 *
 * @returns A fully-resolved config with defaults applied for omitted fields.
 * @throws {EvalConfigError} When the config file cannot be loaded or is invalid.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<Required<FrameworkConfig>> {
  const { configPath, searchDir = process.cwd() } = options;

  const resolvedPath = configPath ? resolve(configPath) : findConfigFile(searchDir);

  if (!resolvedPath) {
    // No config file — return a clone of defaults.
    return structuredClone(DEFAULT_FRAMEWORK_CONFIG);
  }

  const userConfig = await importConfigFile(resolvedPath);
  const merged = deepMerge(DEFAULT_FRAMEWORK_CONFIG, userConfig) as Required<FrameworkConfig>;

  validate(merged, resolvedPath);

  return merged;
}

// ── Internals ────────────────────────────────────────────────────────────────

function findConfigFile(searchDir: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = join(searchDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function importConfigFile(filePath: string): Promise<Partial<FrameworkConfig>> {
  if (!existsSync(filePath)) {
    throw new EvalConfigError('Config file not found', filePath);
  }

  try {
    const fileUrl = pathToFileURL(filePath).href;
    const mod = (await import(fileUrl)) as { default?: unknown };

    if (mod.default === undefined || mod.default === null) {
      throw new EvalConfigError('Config file must have a default export', filePath);
    }

    // CJS interop: Node wraps `module.exports = { … }` as `{ default: { … } }`,
    // so mod.default is the user object in both ESM and CJS cases.
    const exported = mod.default;

    if (typeof exported !== 'object' || Array.isArray(exported)) {
      throw new EvalConfigError('Config file must default-export an object', filePath);
    }

    return exported as Partial<FrameworkConfig>;
  } catch (error) {
    if (error instanceof EvalConfigError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new EvalConfigError(`Failed to load config: ${message}`, filePath);
  }
}

function validate(config: Required<FrameworkConfig>, filePath: string): void {
  if (!config.evalsDir || typeof config.evalsDir !== 'string') {
    throw new EvalConfigError('evalsDir is required and must be a non-empty string', filePath);
  }
}

/**
 * Recursively merges `source` into a clone of `target`.
 *
 * - Objects merge field-by-field (recursive).
 * - Arrays and scalars from `source` replace `target` values.
 * - `undefined` values in `source` are skipped (keep target default).
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = structuredClone(target);

  for (const key of Object.keys(source) as (keyof T)[]) {
    const srcVal = source[key];
    if (srcVal === undefined) continue;

    const tgtVal = result[key];

    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>) as T[keyof T];
    } else {
      result[key] = structuredClone(srcVal) as T[keyof T];
    }
  }

  return result;
}
