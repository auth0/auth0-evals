import { Dirent, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isPathInside } from './path-utils.js';
import { DEFAULT_FRAMEWORK_CONFIG } from '../config/defaults.js';

/**
 * Reads the content of a file inside a workspace, given the workspace root and
 * a path that may be relative (`src/App.tsx`) or absolute
 * (`/private/var/.../workspace/.env`). Returns '' on any failure — a missing or
 * unreadable file simply yields empty content rather than throwing.
 *
 * Workspaces often live under a symlinked tmp dir (macOS /var → /private/var),
 * so both the workspace and the candidate file are canonicalized with
 * realpathSync before comparison; this keeps a symlink from making an
 * in-workspace file look like an escape. Anything that resolves outside the
 * workspace yields ''.
 */
export function readWorkspaceFile(workspace: string, filePath: string): string {
  try {
    let wsReal: string;
    try {
      wsReal = realpathSync(workspace);
    } catch {
      wsReal = resolve(workspace);
    }
    const candidate = isAbsolute(filePath) ? filePath : join(wsReal, filePath);
    let fileReal: string;
    try {
      fileReal = realpathSync(candidate);
    } catch {
      return '';
    }
    if (!isPathInside(wsReal, fileReal)) return '';
    return readFileSync(fileReal, 'utf-8');
  } catch {
    return '';
  }
}

export interface CollectFilesOptions {
  /** Directory names to skip during traversal. Defaults to {@link DEFAULT_FRAMEWORK_CONFIG}.workspace.excludedDirs. */
  excludedDirs?: Set<string>;
  /** Maximum number of files to return. Defaults to {@link DEFAULT_FRAMEWORK_CONFIG}.workspace.maxListedFiles. */
  maxFiles?: number;
}

const defaultExcluded = new Set(DEFAULT_FRAMEWORK_CONFIG.workspace.excludedDirs!);
const defaultMaxFiles = DEFAULT_FRAMEWORK_CONFIG.workspace.maxListedFiles!;

/**
 * Recursively collects file paths under a given root directory, relative to a specified base directory.
 * It skips symlinked directories and files that resolve outside the workspace, and excludes certain directories.
 * The function returns a sorted list of relative file paths, truncated to a maximum number if necessary.
 * @param root The root directory to start collecting files from.
 * @param relativeTo The base directory to which the collected file paths should be relative.
 * @param options Optional overrides for excluded dirs and max file count.
 * @returns An array of relative file paths.
 */
export function collectFiles(root: string, relativeTo: string, options?: CollectFilesOptions): string[] {
  const { files, truncated, maxFiles } = listFiles(root, relativeTo, options);
  return truncated ? [...files, `… (truncated at ${maxFiles} files)`] : files;
}

/** Result of {@link listFiles}: the same walk as {@link collectFiles}, with truncation as data. */
export interface ListedFiles {
  /** Sorted relative paths (never includes a truncation notice). */
  files: string[];
  /** True when the walk stopped at `maxFiles`; {@link collectFiles} then appends its notice. */
  truncated: boolean;
  /** The cap that applied. */
  maxFiles: number;
}

/**
 * The walk behind {@link collectFiles}, returning truncation as a flag instead of a
 * notice entry, for callers that need the file list without parsing the notice.
 */
export function listFiles(root: string, relativeTo: string, options?: CollectFilesOptions): ListedFiles {
  const opts: CollectFilesOptions = options ?? {};
  const excludedDirs: Set<string> = opts.excludedDirs ?? defaultExcluded;
  const maxFiles: number = opts.maxFiles ?? defaultMaxFiles;

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
            if (files.length >= maxFiles) {
              truncated = true;
            }
          }
        } catch {
          // skip broken symlinks or files resolving outside workspace
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        try {
          const realPath = realpathSync(fullPath);
          if (isPathInside(workspaceRoot, realPath)) {
            files.push(relative(relativeTo, fullPath).replace(/\\/g, '/'));
            if (files.length >= maxFiles) {
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
  return { files, truncated, maxFiles };
}
