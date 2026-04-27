import { realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/**
 * Check whether a canonicalized absolute path sits inside a given directory.
 * Uses a separator-aware check to prevent prefix collisions, e.g.
 * dir=/tmp/auth0_eval_A must not match /tmp/auth0_eval_ABC/file.
 */
const MAX_PATH_LENGTH = 4096;

const NULL = '\\0';
const C0_CONTROLS = '\\x01-\\x1f'; // SOH through US (ASCII 1–31)
const DEL = '\\x7f'; // ASCII 127
const C1_CONTROLS = '\\x80-\\x9f'; // Legacy terminal escapes (128–159)

const INVALID_PATH_CHARS = new RegExp(`[${NULL}${C0_CONTROLS}${DEL}${C1_CONTROLS}]`);

/**
 * Validates the raw format of a file path before resolution.
 * Returns an error message if the path is malformed, or null if it's acceptable.
 */
export function validatePathFormat(path: string): string | null {
  if (path.length > MAX_PATH_LENGTH) {
    return `Path too long (${path.length} chars, max ${MAX_PATH_LENGTH})`;
  }
  if (INVALID_PATH_CHARS.test(path)) {
    return 'Path contains invalid characters';
  }
  return null;
}

export function isPathInside(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir + '/');
}

/**
 * Resolve a relative path within a directory and verify it cannot escape
 * via directory traversal (`../`) or symlinks.
 *
 * For files that do not yet exist, the nearest existing ancestor is used for
 * symlink resolution so that newly-written paths are validated as well.
 *
 * @throws {Error} if the resolved path escapes the directory
 */
export function resolveInside(dir: string, relativePath: string): string {
  const formatError = validatePathFormat(relativePath);
  if (formatError) {
    throw new Error(formatError);
  }

  const full = resolve(join(dir, relativePath));

  // Attempt to canonicalize the full path (follows symlinks).
  // For non-existent files, resolve the parent so a symlink in an existing
  // directory cannot redirect reads or writes outside the directory.
  let fullReal: string;
  try {
    fullReal = realpathSync(full);
  } catch {
    const parent = join(full, '..');
    try {
      const parentReal = realpathSync(parent);
      fullReal = join(parentReal, basename(full));
    } catch {
      // Parent also doesn't exist; fall back to the traversal-safe resolved path.
      fullReal = full;
    }
  }

  if (!isPathInside(dir, fullReal)) {
    throw new Error(`path escapes directory: ${relativePath}`);
  }

  return fullReal;
}
