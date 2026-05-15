import { BaseToolTranslator } from '../base-translator.js';

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
  TodoWrite: 'write_file',
  Task: 'run_command',
  TaskOutput: 'read_file',
  KillShell: 'run_command',
  EnterPlanMode: 'plan',
  ExitPlanMode: 'plan',
  Skill: 'skill',
};

export class ClaudeCodeTranslator extends BaseToolTranslator {
  protected readonly toolMap = CC_TOOL_MAP;
  protected readonly docLookupSet = new Set(['WebFetch', 'WebSearch']);
  protected readonly interruptionSet = new Set(['AskUserQuestion']);
  protected readonly internalToolSet = new Set<string>();
  protected readonly logTag = 'ClaudeCodeTranslator';

  protected override isMcpTool(name: string): boolean {
    return name.startsWith('mcp__');
  }

  protected override mapMcpName(name: string): string {
    return name.toLowerCase();
  }

  protected override normalizeFallback(key: string): string {
    return key.toLowerCase();
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
      case 'TodoWrite':
        return {
          path: input.file_path ?? input.path ?? '__todo__',
          content: input.todos != null ? JSON.stringify(input.todos) : String(input.content ?? ''),
        };
      case 'TodoRead':
        return { path: input.file_path ?? input.path ?? '__todo__' };
      case 'Task':
        return { command: input.description ?? input.task ?? '' };
      case 'TaskOutput':
        return { path: input.task_id ?? '' };
      case 'KillShell':
        return { command: `kill shell ${String(input.shell_id ?? input.id ?? '')}`.trim() };
      case 'EnterPlanMode':
      case 'ExitPlanMode':
        return {};
      case 'Skill':
        return { name: input.skill ?? '' };
      default:
        return input;
    }
  }
}
