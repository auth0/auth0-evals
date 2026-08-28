import { BaseToolTranslator } from '../base-translator.js';

const OPENCODE_TOOL_MAP: Record<string, string> = {
  bash: 'run_command',
  read: 'read_file',
  write: 'write_file',
  edit: 'write_file',
  list: 'list_files',
  glob: 'list_files',
  grep: 'list_files',
  webfetch: 'fetch_url',
  todowrite: 'plan',
  todoread: 'plan',
};

export class OpencodeCliTranslator extends BaseToolTranslator {
  protected readonly toolMap = OPENCODE_TOOL_MAP;
  protected readonly docLookupSet = new Set(['webfetch']);
  protected readonly interruptionSet = new Set<string>();
  // todowrite/todoread are agent-internal planning/bookkeeping tools;
  // task is a sub-agent orchestration tool. Excluded from scoring.
  protected readonly internalToolSet = new Set(['todowrite', 'todoread', 'task']);
  protected readonly logTag = 'OpencodeCliTranslator';

  /**
   * Detects opencode MCP tool names.
   *
   * NOTE: the exact format emitted by opencode --format json should be
   * confirmed against a live capture. opencode likely emits MCP tools as
   * `<server>_<tool>` or `<server>.<tool>`. This heuristic matches names
   * that contain a separator AND are not in the native toolMap, which is a
   * reasonable default. Also matches the framework's own `mcp__` prefix (idempotent).
   */
  protected override isMcpTool(name: string): boolean {
    if (name.startsWith('mcp__')) return true;
    // Treat names with dots or double-underscores as MCP tools (server.tool or mcp__s__t).
    if (name.includes('.') || name.includes('__')) return true;
    // Names not in the native tool map that contain a hyphen+underscore combo
    // (e.g. "auth0-docs_search_auth0_docs") — same heuristic as copilot.
    if (!Object.hasOwn(OPENCODE_TOOL_MAP, name) && name.includes('-') && name.includes('_')) return true;
    return false;
  }

  /**
   * Normalizes opencode MCP tool names to the framework's `mcp__<server>__<tool>` convention.
   *
   * NOTE: opencode's exact emitted MCP name separator should be confirmed
   * against a live `--format json` capture. This implementation handles:
   *   - Already-normalized `mcp__server__tool` → unchanged
   *   - `server.tool` → `mcp__server__tool`
   *   - `server_tool` (single underscore prefix) → `mcp__server_tool` (prefixed)
   * Adjust once the live format is confirmed.
   */
  protected override mapMcpName(name: string): string {
    if (name.startsWith('mcp__')) return name;
    // `server.tool` → replace first `.` separator with `__` and prefix with `mcp__`
    if (name.includes('.')) {
      return `mcp__${name.replace('.', '__')}`;
    }
    // Fallback: prefix with `mcp__`
    return `mcp__${name}`;
  }

  override isDocLookup(name: string): boolean {
    return super.isDocLookup(name) || name.includes('fetch') || name.includes('doc');
  }

  normalizeArgs(opencodeName: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (opencodeName) {
      case 'bash':
        // opencode bash tool likely uses `command` — confirm against live capture.
        return { command: args.command ?? args.cmd ?? '' };
      case 'read':
        // opencode read tool likely uses `filePath` — confirm against live capture.
        return { path: args.filePath ?? args.path ?? args.file_path ?? '' };
      case 'write':
        return {
          path: args.filePath ?? args.path ?? args.file_path ?? '',
          content: args.content ?? '',
        };
      case 'edit':
        return {
          path: args.filePath ?? args.path ?? args.file_path ?? '',
          content: args.content ?? args.new_content ?? args.new_string ?? '',
        };
      case 'list':
      case 'glob':
        return { path: args.pattern ?? args.path ?? '' };
      case 'grep':
        return { path: args.path ?? '.', command: `grep "${String(args.pattern ?? '')}"` };
      case 'webfetch':
        return { url: args.url ?? '' };
      case 'todowrite':
      case 'todoread':
        return args;
      default:
        return args;
    }
  }
}
