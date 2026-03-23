import { realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/**
 * Check whether a canonicalized absolute path sits inside a given directory.
 * Uses a separator-aware check to prevent prefix collisions, e.g.
 * dir=/tmp/auth0_eval_A must not match /tmp/auth0_eval_ABC/file.
 */
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
