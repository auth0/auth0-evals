import type { ToolTranslator } from '../../tool-translator.js';
import { logger } from '../../../utils/logger.js';

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
