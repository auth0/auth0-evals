/**
 * Workspace lifecycle helpers.
 *
 * Creates and tears down the temporary directory that every agent run operates
 * in. Shared by all agent runners — not specific to any one agent type.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../utils/logger.js';

/**
 * Creates a fresh temp directory and seeds it with the scaffold files from the
 * eval definition. Returns the absolute path to the workspace.
 */
export function setupWorkspace(scaffold: Record<string, string>): string {
  const workspace = mkdtempSync(join(tmpdir(), 'auth0_eval_'));
  for (const [relPath, content] of Object.entries(scaffold)) {
    const dest = join(workspace, relPath);
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, content, 'utf-8');
    if (relPath === 'gradlew' || relPath.endsWith('/gradlew')) {
      chmodSync(dest, 0o755);
    }
  }
  return workspace;
}

/**
 * Removes the workspace directory and all its contents. Silently ignores
 * errors so a cleanup failure never masks the actual eval result.
 */
export function cleanupWorkspace(workspace: string): void {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch (e) {
    logger.warn(`[Cleanup] Failed to remove workspace ${workspace}: ${e}`);
  }
}
