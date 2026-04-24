/**
 * Human-readable display names for agent tool calls.
 *
 * Used by the scorer to build tool-usage summaries in efficiency notes.
 */

/** Maps internal tool names to short display labels. */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read_file: 'Read',
  list_files: 'List',
  write_file: 'Write',
  run_command: 'Bash',
  fetch_url: 'Fetch',
  ask_user: 'Ask',
};

/** Formats a tool call count map into a human-readable summary string. */
export function formatToolSummary(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([n, c]) => `${TOOL_DISPLAY_NAMES[n] ?? n}×${c}`)
    .join(' ');
}
