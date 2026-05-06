import { existsSync, statSync } from 'node:fs';
import { resolveInside, validatePathFormat, collectFiles } from '@a0/eval';
import { toolResult, errorResult } from './base.js';
import type { Tool, ToolContext, ToolName, ToolResult } from './base.js';

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
        return errorResult(formatError);
      }
    }
    let full: string;
    try {
      full = resolveInside(context.workspace, path);
    } catch {
      return errorResult('Access denied: path is outside workspace');
    }
    if (!existsSync(full)) {
      return toolResult(`Directory not found: '${path}'`);
    }
    if (!statSync(full).isDirectory()) {
      return toolResult(`Path is a file: '${path}'. Use read_file to read its contents.`);
    }
    const lines = collectFiles(full, context.workspace);
    const listing = lines.length > 0 ? lines.join('\n') : '(empty directory)';
    const label = path || '(workspace root)';
    return toolResult(`Directory listing for ${label}:\n${listing}`);
  }
}
