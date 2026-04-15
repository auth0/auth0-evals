/**
 * Shared CLI constants and argument helpers.
 *
 * Imported by both `src/run.ts` (which re-exports them as its public API)
 * and `src/cli/config.ts` (which uses them for validation). Keeping a single
 * source of truth prevents the two files from drifting out of sync.
 */

/** Models known to work reliably across all eval modes. Used when `--model all` is passed. */
export const KNOWN_WORKING_MODELS = ['gpt-5.4', 'claude-4-6-sonnet', 'claude-4-6-opus', 'gemini-3.1-pro-preview'];

/** Model used when no `--model` flag is provided. */
export const DEFAULT_MODEL = 'gpt-5.4';

/** The two concrete execution modes. `"all"` is a CLI meta-value that expands to this union. */
export type Mode = 'baseline' | 'agent';

/** Supported execution modes. `"all"` is a meta-value that expands to this list. */
export const ALL_MODES: Mode[] = ['baseline', 'agent'];

/** Tool names accepted by the `--tools` flag (case-insensitive). */
export const KNOWN_TOOLS = ['skills', 'mcp'];

/**
 * The agent tool-set combinations used by `--mode matrix`.
 * Each entry is a sorted list of tool names. Baseline always runs without tools
 * and is not represented here.
 */
export const MATRIX_TOOL_SETS: string[][] = [['skills'], ['mcp', 'skills']];

/** Agent runner types accepted by the `--agent-type` flag. */
export const KNOWN_AGENT_TYPES = ['auth0-ReAct-agent', 'claude-code', 'copilot', 'gemini-cli'] as const;

/** Union of valid agent runner identifiers, derived from KNOWN_AGENT_TYPES. */
export type AgentType = (typeof KNOWN_AGENT_TYPES)[number];

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
