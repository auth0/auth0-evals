/**
 * Shared CLI constants and argument helpers.
 *
 * Imported by both the run orchestrator and the CLI config parser.
 * Keeping a single source of truth prevents files from drifting out of sync.
 */

export { KNOWN_AGENT_TYPES, ALL_MODES } from '@a0/eval-core';
export type { AgentType, Mode } from '@a0/eval-core';

/** Models known to work reliably across all eval modes. Used when `--model all` is passed. */
export const KNOWN_WORKING_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.5-mini',
  'gpt-5.6',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-haiku-4-5',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
];

/** Model used when no `--model` flag is provided. */
export const DEFAULT_MODEL = 'gpt-5.4';

/** Tool names accepted by the `--tools` flag (case-insensitive). */
export const KNOWN_TOOLS = ['skills', 'mcp'];

/** Agent runner used when no `--agent-type` flag is provided. */
export const DEFAULT_AGENT_TYPE = 'copilot';

// ── Environment variable names ──────────────────────────────────────────────────

/** Environment variable name for the LLM proxy API key. */
export const LLM_API_KEY_ENV = 'LLM_API_KEY';

// ── Docker sandbox constants ────────────────────────────────────────────────────

/** Docker image name used for sandboxed eval runs. */
export const DOCKER_IMAGE_NAME = 'auth0-evals:latest';

/** Mount path inside the container where the workspace is bind-mounted. */
export const DOCKER_WORKSPACE_MOUNT = '/workspace';

/** Filename written inside the container workspace with the job result JSON. */
export const SANDBOX_RESULTS_FILE = '.eval-results.json';

/**
 * Parses the `--tools` flag value into a sorted, deduplicated, lowercase array.
 *
 * Supports both bare comma-separated values (`skills,mcp`) and the brace-wrapped
 * form used by some skill injectors (`{skills}`).
 */
export function parseToolsArg(toolsArg: string): string[] {
  if (!toolsArg) return [];
  let normalized = toolsArg.trim();
  if (normalized.startsWith('{') && normalized.endsWith('}')) {
    normalized = normalized.slice(1, -1);
  }
  return [
    ...new Set(
      normalized
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}
