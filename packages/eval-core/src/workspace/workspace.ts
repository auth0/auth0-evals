/**
 * Workspace lifecycle helpers.
 *
 * Creates and tears down the temporary directory that every agent run operates
 * in. Shared by all agent runners — not specific to any one agent type.
 */

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../utils/logger.js';
import { DEFAULT_FRAMEWORK_CONFIG } from '../config/defaults.js';
import type { AgentType } from '../types/agents.js';
import { resolveInside } from './path-utils.js';

/**
 * Agent guidance steering the agent away from producing documentation/summary
 * files so graders see only source code. Written into each agent's native
 * context file (see {@link AGENT_CONTEXT_FILENAMES}).
 */
export const AGENT_GUIDANCE = `Do not create any documentation files (README.md, SETUP.md, QUICKSTART.md, IMPLEMENTATION_SUMMARY.md, or any other .md files). Do not create any .txt summary or verification files. Do not create standalone summary or status files of any kind (e.g. AUTH0_SETUP.ts, IMPLEMENTATION_COMPLETE.ts, QUICK_START.ts, FILES_CREATED.txt) — these are not application source code. Only create and modify source code files that are part of the application.
`;

/**
 * Env var naming a staging docs base URL. When set and the run is in MCP tool
 * mode, {@link buildStagingDocsGuidance} injects an instruction steering the
 * agent to fetch Auth0 documentation from this base instead of the default
 * production docs — used to test in-progress docs changes (e.g. a Mintlify
 * staging preview) against the eval suite.
 */
export const STAGING_DOCS_URL_ENV = 'AUTH0_DOCS_STAGING_URL';

/**
 * Builds CLAUDE.md guidance that points the agent at a staging docs base URL.
 *
 * Returns an empty string (no guidance) unless `stagingUrl` is a non-empty
 * value, so the default — production docs — is unchanged when the env var is
 * absent. The base URL is normalised (trailing slash stripped); the agent is
 * told to append `.md` to a docs path to fetch raw markdown, which is how
 * Mintlify-hosted docs expose page source.
 *
 * @param stagingUrl staging docs base URL (typically from {@link STAGING_DOCS_URL_ENV})
 */
export function buildStagingDocsGuidance(stagingUrl: string | undefined): string {
  const base = (stagingUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return `When you look up Auth0 documentation, use the staging docs at ${base} as the source of truth — prefer it over any other documentation source, including MCP/search results that reference production docs. To read a docs page, fetch its raw markdown by appending \`.md\` to the page path (e.g. \`${base}/docs/quickstart/native/ios-swift.md\`). Follow the SDK setup, credential configuration, and code patterns from the staging docs.
`;
}

/**
 * The context/memory file each runner reads, relative to the workspace root.
 * Writing guidance to the wrong file means the agent silently ignores it:
 *   - Claude Code reads CLAUDE.md.
 *   - Gemini CLI reads GEMINI.md by default (AGENTS.md needs extra config).
 *   - Codex reads AGENTS.md (official agents.md standard supporter).
 *   - Copilot reads .github/copilot-instructions.md reliably; AGENTS.md is
 *     "not supported by all Copilot features" per GitHub's docs.
 */
export const AGENT_CONTEXT_FILENAMES: Record<AgentType, string> = {
  'claude-code': 'CLAUDE.md',
  'gemini-cli': 'GEMINI.md',
  codex: 'AGENTS.md',
  copilot: '.github/copilot-instructions.md',
};

/**
 * Writes {@link AGENT_GUIDANCE} into the context file the given runner reads.
 * Appends (preserving any scaffold-provided content) when the file already
 * exists; creates it otherwise.
 *
 * When `tools` includes `'mcp'` and the {@link STAGING_DOCS_URL_ENV} env var is
 * set, also appends {@link buildStagingDocsGuidance} so the agent fetches docs
 * from the staging base URL. With the env var unset, behaviour is unchanged.
 *
 * @param tools active tool flags for the run (e.g. `['mcp', 'skills']`)
 */
export function writeAgentGuidance(workspace: string, agentType: AgentType, tools: string[] = []): void {
  const filename = AGENT_CONTEXT_FILENAMES[agentType];
  const dest = join(workspace, filename);

  // If the scaffold shipped AGENTS.md but the active runner reads a different
  // file, rename it so the guidance reaches the right runner.
  const scaffoldAgentsMd = join(workspace, 'AGENTS.md');
  if (filename !== 'AGENTS.md' && existsSync(scaffoldAgentsMd) && !existsSync(dest)) {
    mkdirSync(join(dest, '..'), { recursive: true });
    renameSync(scaffoldAgentsMd, dest);
  }

  // In MCP tool mode, optionally steer the agent at a staging docs base URL.
  const stagingGuidance = tools.includes('mcp') ? buildStagingDocsGuidance(process.env[STAGING_DOCS_URL_ENV]) : '';
  const guidance = stagingGuidance ? `${AGENT_GUIDANCE}\n${stagingGuidance}` : AGENT_GUIDANCE;

  if (existsSync(dest)) {
    appendFileSync(dest, `\n${guidance}`, 'utf-8');
  } else {
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, guidance, 'utf-8');
  }
}

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
