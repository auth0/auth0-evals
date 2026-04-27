/**
 * Workspace lifecycle helpers.
 *
 * Creates and tears down the temporary directory that every agent run operates
 * in. Shared by all agent runners — not specific to any one agent type.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
 * Runs a setup command inside the workspace (e.g. `npm install`).
 * Called after scaffold files are written and before the agent starts.
 *
 * Only simple commands are supported — no quoting, escaping, or shell
 * operators. The command string is split on whitespace into argv tokens.
 * This is intentional: setup commands come from our own PROMPT.md
 * frontmatter, not from user input.
 */
export function runSetupCommand(workspace: string, command: string): void {
  logger.info(`  [Setup] Running: ${command}`);
  const args = command.trim().split(/\s+/);
  const cmd = args.shift();
  if (!cmd) {
    throw new Error('Setup command is empty');
  }
  const result = spawnSync(cmd, args, { cwd: workspace, stdio: 'inherit', timeout: 120_000 });
  if (result.error) {
    throw new Error(`Setup command failed: ${command}`, { cause: result.error });
  }
  if (result.signal) {
    const timeoutNote = result.signal === 'SIGTERM' ? ' (possibly timed out after 120000ms)' : '';
    throw new Error(`Setup command failed with signal ${result.signal}${timeoutNote}: ${command}`);
  }
  if (result.status !== 0) {
    throw new Error(`Setup command failed with exit code ${result.status}: ${command}`);
  }
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
