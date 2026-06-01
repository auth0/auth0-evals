import { BaseToolTranslator } from '../base-translator.js';

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

export class CopilotCliTranslator extends BaseToolTranslator {
  protected readonly toolMap = COPILOT_TOOL_MAP;
  protected readonly docLookupSet = new Set(['web_fetch', 'web_search']);
  protected readonly interruptionSet = new Set(['ask_user']);
  protected readonly internalToolSet = new Set(['report_intent', 'skill', 'stop_bash', 'list_bash']);
  protected readonly logTag = 'CopilotCliTranslator';

  protected override normalizeKey(name: string): string {
    return name.toLowerCase();
  }

  /** Detects Copilot SDK MCP tool names in both legacy `mcp__<server>__<tool>` and `<server>-<tool_name>` formats. */
  protected override isMcpTool(key: string): boolean {
    // MCP tools have underscores in the tool portion but use hyphens for the server prefix.
    // e.g. "auth0-docs-search_auth0_docs" — contains both "-" and "_".
    return key.startsWith('mcp__') || (key.includes('-') && key.includes('_'));
  }

  // Prefix the `<server>-<tool>` form with mcp__ so classifyActionType
  // recognizes it as an MCP call and classifies it as Discovery.
  protected override mapMcpName(key: string): string {
    return key.startsWith('mcp__') ? key : `mcp__${key}`;
  }

  normalizeArgs(copilotName: string, input: Record<string, unknown>): Record<string, unknown> {
    switch (copilotName.toLowerCase()) {
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
}
