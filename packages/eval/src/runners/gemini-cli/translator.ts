import { BaseToolTranslator } from '../base-translator.js';

const GEMINI_TOOL_MAP: Record<string, string> = {
  list_directory: 'bash',
  run_shell_command: 'bash',
  create_directory: 'bash',
  move_file: 'bash',
  copy_file: 'bash',
  delete_file: 'bash',
  read_file: 'read',
  write_file: 'write',
  edit_file: 'edit',
  replace_in_file: 'edit',
  glob: 'glob',
  grep: 'grep',
  web_fetch: 'webfetch',
  web_search: 'webfetch',
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
    return name;
  }

  override isDocLookup(name: string): boolean {
    return super.isDocLookup(name) || name.includes('search') || name.includes('doc');
  }

  normalizeArgs(geminiName: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (geminiName) {
      case 'run_shell_command':
        return { command: args.command ?? args.cmd ?? '' };
      case 'list_directory':
      case 'create_directory':
        return { path: args.path ?? args.directory ?? '' };
      case 'read_file':
        return { path: args.path ?? args.file_path ?? '' };
      case 'write_file':
        return { path: args.path ?? args.file_path ?? '', content: args.content ?? '' };
      case 'edit_file':
      case 'replace_in_file':
        return {
          path: args.path ?? args.file_path ?? '',
          content: args.new_content ?? args.new_string ?? args.content ?? '',
        };
      case 'move_file':
      case 'copy_file':
        return { path: args.destination ?? args.path ?? '' };
      case 'delete_file':
        return { path: args.path ?? args.file_path ?? '' };
      case 'glob':
        return { path: args.pattern ?? args.path ?? '' };
      case 'grep':
        return { path: args.path ?? '.', command: `grep "${String(args.pattern ?? '')}"` };
      case 'web_fetch':
        return { url: args.url ?? '' };
      case 'web_search':
        return { url: args.query ?? '' };
      default:
        return args;
    }
  }
}
