import type { ToolTranslator } from '@a0/eval';
import { logger } from '../../../utils/logger.js';

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

const GEMINI_DOC_LOOKUP_TOOLS = new Set(['web_fetch', 'web_search']);

/**
 * Translator for the Gemini CLI agent.
 * Maps Gemini CLI tool names and argument shapes to the internal taxonomy
 * expected by the scorer and report pipeline.
 */
export class GeminiCliTranslator implements ToolTranslator {
  mapName(geminiName: string): string {
    if (geminiName.startsWith('mcp_')) return 'mcp';
    if (geminiName in GEMINI_TOOL_MAP) return GEMINI_TOOL_MAP[geminiName]!;
    logger.warn(`[GeminiCliTranslator] Unknown tool "${geminiName}" — falling back to "${geminiName}"`);
    return geminiName;
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

  isDocLookup(geminiName: string): boolean {
    return (
      GEMINI_DOC_LOOKUP_TOOLS.has(geminiName) ||
      geminiName.startsWith('mcp_') ||
      geminiName.includes('search') ||
      geminiName.includes('doc')
    );
  }

  isInterruption(_geminiName: string): boolean {
    return false;
  }

  isInternalTool(_geminiName: string): boolean {
    return false;
  }
}
