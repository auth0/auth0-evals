import { Dirent, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isPathInside } from './../path-utils.js';
import { EXCLUDED_DIRS, MAX_LISTED_FILES } from './../../config/settings.js';

/**
 * Recursively collects file paths under a given root directory, relative to a specified base directory.
 * It skips symlinked directories and files that resolve outside the workspace, and excludes certain directories.
 * The function returns a sorted list of relative file paths, truncated to a maximum number if necessary.
 * @param root The root directory to start collecting files from.
 * @param relativeTo The base directory to which the collected file paths should be relative.
 * @returns An array of relative file paths.
 */
export function collectFiles(root: string, relativeTo: string): string[] {
  // Use realpathSync to resolve symlinks in the workspace root itself (e.g. /var -> /private/var on macOS)
  let workspaceRoot: string;
  try {
    workspaceRoot = realpathSync(relativeTo);
  } catch {
    workspaceRoot = resolve(relativeTo);
  }

  const files: string[] = [];
  let truncated = false;

  function walk(dir: string): void {
    if (truncated) return;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) break;
      const fullPath = join(dir, entry.name);

      // Skip symlinked directories (followlinks=False equivalent)
      if (entry.isSymbolicLink()) {
        // Only include symlinked files if they resolve within workspace
        try {
          const realPath = realpathSync(fullPath);
          if (isPathInside(workspaceRoot, realPath) && statSync(fullPath).isFile()) {
            files.push(relative(relativeTo, fullPath).replace(/\\/g, '/'));
            if (files.length >= MAX_LISTED_FILES) {
              truncated = true;
            }
          }
        } catch {
          // skip broken symlinks or files resolving outside workspace
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        try {
          const realPath = realpathSync(fullPath);
          if (isPathInside(workspaceRoot, realPath)) {
            files.push(relative(relativeTo, fullPath).replace(/\\/g, '/'));
            if (files.length >= MAX_LISTED_FILES) {
              truncated = true;
            }
          }
        } catch {
          // skip
        }
      }
    }
  }

  walk(root);
  files.sort();
  if (truncated) {
    files.push(`… (truncated at ${MAX_LISTED_FILES} files)`);
  }
  return files;
}
