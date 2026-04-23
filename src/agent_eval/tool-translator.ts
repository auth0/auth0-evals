/**
 * ToolTranslator interface.
 *
 * Each agent runner has its own native tool vocabulary. ToolTranslator converts
 * an agent's tool names and arguments into the internal taxonomy used by the
 * scorer and report pipeline (read_file, write_file, run_command, etc.).
 *
 * Implementations live in each runner's directory:
 *   - runners/react/identity-translator.ts
 *   - runners/claude-code/translator.ts
 *   - runners/copilot/translator.ts
 *
 * To add a new agent with different tool names:
 *   1. Implement ToolTranslator for that agent's vocabulary.
 *   2. Use it inside that agent's runner — no changes elsewhere.
 */

export interface ToolTranslator {
  /**
   * Map an agent-specific tool name to the internal taxonomy.
   * E.g. Claude Code 'Bash' → 'run_command'
   */
  mapName(agentToolName: string): string;

  /**
   * Normalize agent-specific tool arguments to the internal schema.
   * E.g. Claude Code { file_path: 'x' } → { path: 'x' }
   */
  normalizeArgs(agentToolName: string, args: Record<string, unknown>): Record<string, unknown>;

  /** Whether the tool represents a documentation lookup (for scoring). */
  isDocLookup(agentToolName: string): boolean;

  /** Whether the tool represents a user interruption (for scoring). */
  isInterruption(agentToolName: string): boolean;

  /**
   * Whether this tool is an internal bookkeeping tool that should not be
   * counted toward scoring. Defaults to false for non-internal agents.
   */
  isInternalTool(agentToolName: string): boolean;
}
