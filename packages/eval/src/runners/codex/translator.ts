import { BaseToolTranslator } from '../base-translator.js';

/**
 * Maps Codex CLI tool names to the internal taxonomy.
 *
 * Codex CLI (in --json mode) reports tool calls with names matching the
 * OpenAI function-calling tool vocabulary. These are mapped to the
 * canonical names used by the scorer.
 */
const CODEX_TOOL_MAP: Record<string, string> = {
  // Codex CLI actual event type (item.started/item.completed)
  command_execution: 'run_command',
  // Function-calling tool name (confirmed from proxy logs: "name":"exec_command")
  exec_command: 'run_command',
  // Older / function-calling names
  shell: 'run_command',
  bash: 'run_command',
  run_command: 'run_command',
  read_file: 'read_file',
  write_file: 'write_file',
  edit_file: 'write_file',
  patch: 'write_file',
  apply_diff: 'write_file',
  create_file: 'write_file',
  delete_file: 'run_command',
  list_files: 'list_files',
  glob: 'list_files',
  grep: 'list_files',
  web_fetch: 'fetch_url',
  web_search: 'fetch_url',
};

export class CodexTranslator extends BaseToolTranslator {
  protected readonly toolMap = CODEX_TOOL_MAP;
  protected readonly docLookupSet = new Set(['web_fetch', 'web_search']);
  protected readonly interruptionSet = new Set<string>();
  protected readonly internalToolSet = new Set<string>();
  protected readonly logTag = 'CodexTranslator';

  protected override isMcpTool(name: string): boolean {
    return name.startsWith('mcp_') || name.startsWith('mcp__');
  }

  override isDocLookup(name: string): boolean {
    return super.isDocLookup(name) || name.includes('search') || name.includes('doc');
  }

  normalizeArgs(codexName: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (codexName) {
      case 'command_execution':
      case 'exec_command':
      case 'shell':
      case 'bash':
      case 'run_command':
        return { command: args.command ?? args.cmd ?? args.input ?? '' };
      case 'read_file':
        return { path: args.path ?? args.file_path ?? args.file ?? '' };
      case 'write_file':
      case 'create_file':
        return { path: args.path ?? args.file_path ?? args.file ?? '', content: args.content ?? '' };
      case 'edit_file':
      case 'patch':
      case 'apply_diff':
        return {
          path: args.path ?? args.file_path ?? args.file ?? '',
          content: args.new_content ?? args.content ?? args.diff ?? '',
        };
      case 'delete_file':
        return { command: `rm ${String(args.path ?? args.file_path ?? args.file ?? '')}` };
      case 'list_files':
        return { path: args.path ?? args.directory ?? '.' };
      case 'glob':
        return { path: args.pattern ?? args.path ?? '' };
      case 'grep':
        return { path: args.path ?? '.', command: `grep "${String(args.pattern ?? args.query ?? '')}"` };
      case 'web_fetch':
        return { url: args.url ?? '' };
      case 'web_search':
        return { url: args.query ?? '' };
      default:
        return args;
    }
  }
}
