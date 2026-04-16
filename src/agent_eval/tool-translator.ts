/**
 * ToolTranslator interface and implementations.
 *
 * Each agent runner has its own native tool vocabulary. ToolTranslator converts
 * an agent's tool names and arguments into the internal taxonomy used by the
 * scorer and report pipeline (read_file, write_file, run_command, etc.).
 *
 * To add a new agent with different tool names:
 *   1. Implement ToolTranslator for that agent's vocabulary.
 *   2. Use it inside that agent's runner — no changes elsewhere.
 */

import { logger } from '../utils/logger.js';

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
    logger.warn(`[ClaudeCodeTranslator] Unknown tool "${ccName}" — falling back to "${ccName.toLowerCase()}"`);
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

// ── CopilotCliTranslator ─────────────────────────────────────────────────────

const COPILOT_TOOL_MAP: Record<string, string> = {
  bash: 'run_command',
  read_bash: 'run_command',
  view: 'read_file',
  read: 'read_file',
  write: 'write_file',
  create: 'write_file',
  edit: 'write_file',
  apply_patch: 'write_file',
  glob: 'list_files',
  grep: 'list_files',
  rg: 'list_files',
  web_fetch: 'fetch_url',
  web_search: 'fetch_url',
  ask_user: 'ask_user',
};

const COPILOT_DOC_LOOKUP_TOOLS = new Set(['web_fetch', 'web_search']);
const COPILOT_INTERRUPTION_TOOLS = new Set(['ask_user']);

/**
 * Translator for GitHub Copilot CLI JSONL tool events.
 * Maps Copilot tool names and argument shapes to internal scorer taxonomy.
 */
export class CopilotCliTranslator implements ToolTranslator {
  private readonly internalTools = new Set(['report_intent', 'skill', 'stop_bash', 'list_bash']);

  mapName(copilotName: string): string {
    const key = copilotName.toLowerCase();
    if (key in COPILOT_TOOL_MAP) return COPILOT_TOOL_MAP[key]!;
    // MCP tools: Copilot SDK emits them as "<server-name>-<tool>" (e.g. "auth0-docs-search_auth0_docs")
    // or the legacy double-underscore format "mcp__<server>__<tool>".
    if (key.startsWith('mcp__') || this.isMcpTool(key)) return key;
    logger.warn(`[CopilotCliTranslator] Unknown tool "${copilotName}" — falling back to "${key}"`);
    return key;
  }

  /** Detects Copilot SDK MCP tool names in "<server-name>-<tool_name>" format. */
  private isMcpTool(key: string): boolean {
    // MCP tools have underscores in the tool portion but use hyphens for the server prefix.
    // e.g. "auth0-docs-search_auth0_docs" — contains both "-" and "_".
    return key.includes('-') && key.includes('_');
  }

  normalizeArgs(copilotName: string, input: Record<string, unknown>): Record<string, unknown> {
    const key = copilotName.toLowerCase();
    switch (key) {
      case 'bash':
      case 'read_bash':
        return { command: input.command ?? input.cmd ?? '' };
      case 'view':
      case 'read':
        return { path: input.path ?? input.file_path ?? '' };
      case 'write':
      case 'create':
      case 'edit':
      case 'apply_patch':
        return { path: input.path ?? input.file_path ?? '', content: input.content ?? input.new_str ?? '' };
      case 'glob':
      case 'grep':
        return { path: input.pattern ?? input.path ?? '' };
      case 'web_fetch':
        return { url: input.url ?? '' };
      case 'web_search':
        return { url: input.query ?? '' };
      case 'ask_user':
        return { question: input.question ?? '' };
      default:
        return input;
    }
  }

  isDocLookup(copilotName: string): boolean {
    const key = copilotName.toLowerCase();
    return COPILOT_DOC_LOOKUP_TOOLS.has(key) || key.startsWith('mcp__') || this.isMcpTool(key);
  }

  isInterruption(copilotName: string): boolean {
    return COPILOT_INTERRUPTION_TOOLS.has(copilotName.toLowerCase());
  }

  isInternalTool(copilotName: string): boolean {
    return this.internalTools.has(copilotName.toLowerCase());
  }
}
