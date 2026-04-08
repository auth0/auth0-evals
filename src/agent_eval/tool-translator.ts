/**
 * ToolTranslator interface and implementations.
 *
 * Each agent runner has its own native tool vocabulary. ToolTranslator converts
 * an agent's tool names and arguments into the internal taxonomy used by the
 * scorer and report pipeline (read_file, write_file, run_command, etc.).
 *
 * To add a new agent with different tool names (Codex, Gemini CLI, etc.):
 *   1. Implement ToolTranslator for that agent's vocabulary.
 *   2. Use it inside that agent's runner — no changes elsewhere.
 */

// ── Interface ─────────────────────────────────────────────────────────────────

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

// ── IdentityTranslator ────────────────────────────────────────────────────────

/**
 * No-op translator for agents that already use the internal taxonomy.
 * Used by the ReAct agent — its tool names are the internal names.
 */
export class IdentityTranslator implements ToolTranslator {
  mapName(name: string): string {
    return name;
  }

  normalizeArgs(_toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    return args;
  }

  isDocLookup(_toolName: string): boolean {
    return false;
  }

  isInterruption(_toolName: string): boolean {
    return false;
  }

  isInternalTool(_toolName: string): boolean {
    return false;
  }
}

// ── ClaudeCodeTranslator ──────────────────────────────────────────────────────

const CC_TOOL_MAP: Record<string, string> = {
  Bash: 'run_command',
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'write_file',
  MultiEdit: 'write_file',
  Glob: 'list_files',
  Grep: 'list_files',
  LS: 'list_files',
  WebFetch: 'fetch_url',
  WebSearch: 'fetch_url',
  AskUserQuestion: 'ask_user',
  TodoRead: 'read_file',
  Skill: 'skill',
};

const CC_DOC_LOOKUP_TOOLS = new Set(['WebFetch', 'WebSearch']);
const CC_INTERRUPTION_TOOLS = new Set(['AskUserQuestion']);

/**
 * Translator for the Claude Code CLI agent.
 * Maps Claude Code's native tool names and argument shapes to the internal
 * taxonomy expected by the scorer and report pipeline.
 */
export class ClaudeCodeTranslator implements ToolTranslator {
  private readonly internalTools = new Set([
    'TodoWrite',
    'TodoRead',
    'Task',
    'TaskOutput',
    'KillShell',
    'EnterPlanMode',
    'ExitPlanMode',
  ]);

  mapName(ccName: string): string {
    if (ccName in CC_TOOL_MAP) return CC_TOOL_MAP[ccName]!;
    if (ccName.startsWith('mcp__')) return ccName.toLowerCase();
    console.warn(`[ClaudeCodeTranslator] Unknown tool "${ccName}" — falling back to "${ccName.toLowerCase()}"`);
    return ccName.toLowerCase();
  }

  normalizeArgs(ccName: string, input: Record<string, unknown>): Record<string, unknown> {
    switch (ccName) {
      case 'Bash':
        return { command: input.command ?? input.cmd ?? '' };
      case 'Read':
        return { path: input.file_path ?? input.path ?? '' };
      case 'Write':
        return { path: input.file_path ?? input.path ?? '', content: input.content ?? '' };
      case 'Edit':
        return { path: input.file_path ?? input.path ?? '', content: input.new_string ?? input.content ?? '' };
      case 'MultiEdit':
        return { path: input.file_path ?? input.path ?? '' };
      case 'Glob':
        return { path: input.pattern ?? input.path ?? '' };
      case 'Grep':
        return { path: input.path ?? '.', command: `grep "${String(input.pattern ?? '')}"` };
      case 'LS':
        return { path: input.path ?? '.' };
      case 'WebFetch':
        return { url: input.url ?? '' };
      case 'WebSearch':
        return { url: input.query ?? '' };
      case 'AskUserQuestion':
        return { question: input.question ?? '' };
      case 'Skill':
        return { name: input.skill ?? '' };
      default:
        return input;
    }
  }

  isDocLookup(ccName: string): boolean {
    return CC_DOC_LOOKUP_TOOLS.has(ccName) || ccName.startsWith('mcp__');
  }

  isInterruption(ccName: string): boolean {
    return CC_INTERRUPTION_TOOLS.has(ccName);
  }

  isInternalTool(ccName: string): boolean {
    return this.internalTools.has(ccName);
  }
}
