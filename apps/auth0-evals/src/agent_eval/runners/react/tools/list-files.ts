import { existsSync, statSync } from 'node:fs';
import { Tool, ToolContext, ToolName, ToolResult } from './base.js';
import { resolveInside, validatePathFormat } from '../../../path-utils.js';
import { collectFiles } from './utils.js';

function wrapResult(message: string, isError: boolean = false): ToolResult {
  return [message, false, false, isError];
}

/**
 * ListFilesTool allows the agent to list files in a directory within the workspace.
 * It takes a relative path as an argument and returns a listing of files and directories at that path.
 * If the path is invalid, outside the workspace, or points to a file instead of a directory, it returns an appropriate error message.
 */
export class ListFilesTool implements Tool {
  name: ToolName = 'list_files';

  async run(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const path = (args.path as string) ?? '';
    if (path) {
      const formatError = validatePathFormat(path);
      if (formatError) {
        return wrapResult(formatError, true);
      }
    }
    let full: string;
    try {
      full = resolveInside(context.workspace, path);
    } catch {
      return wrapResult('Access denied: path is outside workspace', true);
    }
    if (!existsSync(full)) {
      return wrapResult(`Directory not found: '${path}'`);
    }
    if (!statSync(full).isDirectory()) {
      return wrapResult(`Path is a file: '${path}'. Use read_file to read its contents.`);
    }
    const lines = collectFiles(full, context.workspace);
    const listing = lines.length > 0 ? lines.join('\n') : '(empty directory)';
    const label = path || '(workspace root)';
    return wrapResult(`Directory listing for ${label}:\n${listing}`);
  }
}
