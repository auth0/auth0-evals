/**
 * Copies a workspace into a throwaway sibling directory and applies the
 * fake→real credential swap across text files. The original workspace (which
 * static graders saw and which gets reported) is never mutated.
 *
 * node_modules is skipped — the runtime grader reinstalls/serves from the copy,
 * and copying node_modules would be slow and large. Dotfiles like .env ARE
 * copied so the agent's env wiring carries over.
 */

import { cpSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

export interface PreparedRuntimeWorkspace {
  /** Absolute path to the throwaway copy. */
  copyPath: string;
  /** Removes the copy. Safe to call multiple times. */
  cleanup: () => void;
}

// Binary/build dirs that must not be swapped or copied.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.nuxt', '.output', '.angular']);

// Only swap inside text files. Skip anything that looks binary by extension.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|jar|class|so|dylib|node)$/i;

function applySwapInDir(dir: string, swap: Array<{ from: string; to: string }>): void {
  if (swap.length === 0) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      applySwapInDir(join(dir, entry.name), swap);
    } else if (entry.isFile()) {
      if (BINARY_EXT.test(entry.name)) continue;
      const full = join(dir, entry.name);
      let content: string;
      try {
        content = readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      let next = content;
      for (const { from, to } of swap) {
        next = next.split(from).join(to);
      }
      if (next !== content) writeFileSync(full, next, 'utf-8');
    }
  }
}

export function prepareRuntimeWorkspace(
  workspace: string,
  swap: Array<{ from: string; to: string }>,
): PreparedRuntimeWorkspace {
  const copyPath = mkdtempSync(join(dirname(workspace), basename(workspace) + '-runtime-'));

  cpSync(workspace, copyPath, {
    recursive: true,
    filter: (src) => {
      try {
        if (statSync(src).isDirectory() && SKIP_DIRS.has(basename(src))) return false;
      } catch {
        return false;
      }
      return true;
    },
  });

  applySwapInDir(copyPath, swap);

  return {
    copyPath,
    cleanup: () => rmSync(copyPath, { recursive: true, force: true }),
  };
}
