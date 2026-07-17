import { BaseToolTranslator } from '../base-translator.js';

const GEMINI_TOOL_MAP: Record<string, string> = {
  list_directory: 'list_files',
  run_shell_command: 'run_command',
  create_directory: 'run_command',
  move_file: 'run_command',
  copy_file: 'run_command',
  delete_file: 'run_command',
  read_file: 'read_file',
  write_file: 'write_file',
  edit_file: 'write_file',
  replace_in_file: 'write_file',
  replace: 'write_file',
  glob: 'list_files',
  grep: 'list_files',
  web_fetch: 'fetch_url',
  web_search: 'fetch_url',
  update_topic: 'plan',
  activate_skill: 'skill',
};

export class GeminiCliTranslator extends BaseToolTranslator {
  protected readonly toolMap = GEMINI_TOOL_MAP;
  protected readonly docLookupSet = new Set(['web_fetch', 'web_search']);
  protected readonly interruptionSet = new Set<string>();
  protected readonly internalToolSet = new Set<string>();
  protected readonly logTag = 'GeminiCliTranslator';

  protected override isMcpTool(name: string): boolean {
    return name.startsWith('mcp_');
  }

  protected override mapMcpName(name: string): string {
    // Gemini CLI (>=0.46) emits MCP tool names as `mcp_<server>_<tool>` with a
    // single-underscore prefix; the framework convention used by the trace-based
    // MCP graders (and every other runner) is the double-underscore `mcp__`
    // prefix. Normalize the prefix so `calledTool`/`calledToolOneOf` match.
    // Idempotent: names already on the `mcp__` convention are left untouched.
    if (name.startsWith('mcp__')) return name;
    return `mcp__${name.slice('mcp_'.length)}`;
  }

  override isDocLookup(name: string): boolean {
    return super.isDocLookup(name) || name.includes('search') || name.includes('doc');
  }

  normalizeArgs(geminiName: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (geminiName) {
      case 'run_shell_command':
        return { command: args.command ?? args.cmd ?? '' };
      case 'list_directory':
        return { path: args.path ?? args.directory ?? '' };
      case 'create_directory':
        return { command: `mkdir ${String(args.path ?? args.directory ?? '')}` };
      case 'read_file':
        return { path: args.path ?? args.file_path ?? '' };
      case 'write_file':
        return { path: args.path ?? args.file_path ?? '', content: args.content ?? '' };
      case 'edit_file':
      case 'replace_in_file':
      case 'replace':
        return {
          path: args.path ?? args.file_path ?? '',
          content: args.new_content ?? args.new_string ?? args.content ?? '',
        };
      case 'move_file':
        return { command: `mv ${String(args.source ?? args.path ?? '')} ${String(args.destination ?? '')}` };
      case 'copy_file':
        return { command: `cp ${String(args.source ?? args.path ?? '')} ${String(args.destination ?? '')}` };
      case 'delete_file':
        return { command: `rm ${String(args.path ?? args.file_path ?? '')}` };
      case 'glob':
        return { path: args.pattern ?? args.path ?? '' };
      case 'grep':
        return { path: args.path ?? '.', command: `grep "${String(args.pattern ?? '')}"` };
      case 'web_fetch':
        return { url: args.url ?? '' };
      case 'web_search':
        return { url: args.query ?? '' };
      case 'activate_skill':
        return { name: args.skill ?? args.name ?? '' };
      case 'update_topic':
        return args;
      default:
        return args;
    }
  }
}
