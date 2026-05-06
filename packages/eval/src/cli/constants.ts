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
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'gemini-3.1-pro-preview',
];

/** Model used when no `--model` flag is provided. */
export const DEFAULT_MODEL = 'gpt-5.4';

/** Tool names accepted by the `--tools` flag (case-insensitive). */
export const KNOWN_TOOLS = ['skills', 'mcp'];

/**
 * The agent tool-set combinations used by `--mode matrix`.
 * Each entry is a sorted list of tool names. Baseline always runs without tools
 * and is not represented here.
 */
export const MATRIX_TOOL_SETS: string[][] = [['skills'], ['mcp', 'skills']];

/** Agent runner used when no `--agent-type` flag is provided. */
export const DEFAULT_AGENT_TYPE = 'auth0-ReAct-agent';

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
