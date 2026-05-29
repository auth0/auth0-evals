/**
 * Workspace lifecycle helpers.
 *
 * Creates and tears down the temporary directory that every agent run operates
 * in. Shared by all agent runners — not specific to any one agent type.
 */

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../utils/logger.js';
import { DEFAULT_FRAMEWORK_CONFIG } from '../config/defaults.js';
import { resolveInside } from './path-utils.js';

export interface SetupWorkspaceOptions {
  /** Prefix for the temp directory name. Defaults to {@link DEFAULT_FRAMEWORK_CONFIG}.workspace.tempDirPrefix. */
  tempDirPrefix?: string;
}

export interface RunSetupCommandOptions {
  /** Timeout in ms for the setup command. Defaults to {@link DEFAULT_FRAMEWORK_CONFIG}.workspace.setupCommandTimeoutMs. */
  timeoutMs?: number;
}

/**
 * Creates a fresh temp directory and seeds it with the scaffold files from the
 * eval definition. Returns the absolute path to the workspace.
 */
export function setupWorkspace(scaffold: Record<string, string>, options?: SetupWorkspaceOptions): string {
  const prefix: string = options?.tempDirPrefix ?? DEFAULT_FRAMEWORK_CONFIG.workspace.tempDirPrefix!;
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  for (const [relPath, content] of Object.entries(scaffold)) {
    let dest: string;
    try {
      dest = resolveInside(workspace, relPath);
    } catch (e) {
      logger.warn(
        `[Workspace] Skipping scaffold file due to path validation: ${relPath} (${e instanceof Error ? e.message : 'unknown error'})`,
      );
      continue;
    }
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
 * Supports `&&`-chained commands by splitting on `&&` and running each
 * sub-command in sequence. Each sub-command is split on whitespace into argv
 * tokens — no quoting, escaping, or other shell operators are supported.
 * This is intentional: setup commands come from our own PROMPT.md frontmatter,
 * not from user input.
 */
export function runSetupCommand(workspace: string, command: string, options?: RunSetupCommandOptions): void {
  const timeout = options?.timeoutMs ?? DEFAULT_FRAMEWORK_CONFIG.workspace.setupCommandTimeoutMs!;
  if (!command.trim()) {
    throw new Error('Setup command is empty');
  }
  const subCommands = command.split('&&').map((s) => s.trim());
  const emptyIndex = subCommands.findIndex((s) => !s);
  if (emptyIndex !== -1) {
    throw new Error(`Setup command has an empty segment at position ${emptyIndex}: ${command}`);
  }
  for (const subCommand of subCommands) {
    logger.info(`  [Setup] Running: ${subCommand}`);
    const args = subCommand.split(/\s+/);
    const cmd = args.shift()!;
    const result = spawnSync(cmd, args, { cwd: workspace, stdio: 'inherit', timeout });
    if (result.error) {
      throw new Error(`Setup command failed: ${subCommand}`, { cause: result.error });
    }
    if (result.signal) {
      const timeoutNote = result.signal === 'SIGTERM' ? ` (possibly timed out after ${timeout}ms)` : '';
      throw new Error(`Setup command failed with signal ${result.signal}${timeoutNote}: ${subCommand}`);
    }
    if (result.status !== 0) {
      throw new Error(`Setup command failed with exit code ${result.status}: ${subCommand}`);
    }
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
