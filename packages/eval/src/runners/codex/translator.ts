import { BaseToolTranslator } from '../base-translator.js';

/** Shell commands that read a file without mutating it. */
const READ_ONLY_COMMANDS = new Set(['cat', 'head', 'tail', 'nl', 'sed']);

/**
 * Detects whether a shell command is an unambiguous, read-only read of a
 * single file and returns that file path (else null).
 *
 * Codex performs file reads through the shell (`cat`, `sed -n`, `nl`, …), so
 * without this they record as `run_command` — unlike file-native runners whose
 * reads are `read_file`. That asymmetry skews the Efficiency dimension, whose
 * duplicate-read detection only fires for `read_file` (and is reset by every
 * `run_command`). Mapping clean reads to `read_file` restores parity.
 *
 * Deliberately strict: any shell metacharacter (pipe, redirect, chain, glob,
 * subshell, variable expansion, background) or follow/in-place flag disqualifies
 * the command, so a mutating or compound command is never misread as a plain read.
 */
export function detectReadOnlyFileRead(rawCommand: string): string | null {
  let cmd = rawCommand.trim();

  // Unwrap at most one shell wrapper: `/bin/zsh -lc "…"`, `bash -c '…'`, `sh -c "…"`.
  const wrapper = /^(?:\/[\w./-]+\/)?(?:zsh|bash|sh)\s+-[a-z]*c\s+(['"])([\s\S]*)\1$/.exec(cmd);
  if (wrapper?.[2]) cmd = wrapper[2].trim();

  // Reject shell metacharacters that could chain, redirect, pipe, glob, expand,
  // or background — these make single-file attribution unsafe.
  if (/[|&;<>`$*?(){}[\]]/.test(cmd) || cmd.includes('\n')) return null;

  const tokens = cmd.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const command = tokens[0]!;
  if (!READ_ONLY_COMMANDS.has(command)) return null;

  const flags = tokens.slice(1).filter((t) => t.startsWith('-'));
  // `tail -f` follows (long-running, not a one-shot read).
  if (flags.some((f) => f === '-f' || f === '--follow')) return null;
  // `sed` only reads when `-n` is present and it is not editing in place (`-i`).
  if (command === 'sed') {
    if (flags.some((f) => f === '-i' || f.startsWith('-i') || f === '--in-place')) return null;
    if (!flags.includes('-n')) return null;
  }

  // The file is the last token. Strip one layer of matching surrounding quotes.
  let path = tokens[tokens.length - 1]!;
  const quoted = /^(['"])([\s\S]*)\1$/.exec(path);
  if (quoted) path = quoted[2]!;

  // Must look like a real path (has a directory separator or extension) so we
  // never mistake a `sed` script (e.g. `1,220p`) or bare token for a filename.
  if (path.startsWith('-') || !/[./]/.test(path)) return null;

  return path;
}

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
