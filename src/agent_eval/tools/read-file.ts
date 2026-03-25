import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { resolveInside } from './../path-utils.js';
import { collectFiles } from './utils.js';
import { Tool, ToolContext, ToolName, ToolResult } from './base.js';

function wrapResult(message: string): ToolResult {
  return [message, false, false, false];
}

/**
 * ReadFileTool allows the agent to read the contents of a file within the workspace.
 * It takes a relative path as an argument and returns the contents of the file at that path.
 * If the path is invalid, outside the workspace, or points to a directory instead of a file, it returns an appropriate error message.
 */
export class ReadFileTool implements Tool {
  name: ToolName = 'read_file';

  async run(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const path = args.path as string;
    if (!path?.trim()) {
      throw new Error('read_file requires a file path. To list workspace files use list_files with an empty string.');
    }
    let full: string;
    try {
      full = resolveInside(context.workspace, path);
    } catch {
      return wrapResult('Access denied: path is outside workspace');
    }
    if (existsSync(full) && statSync(full).isDirectory()) {
      return wrapResult(`Path is a directory: '${path}'. Use list_files to list its contents.`);
    }
    if (!existsSync(full)) {
      const parent = join(full, '..');
      if (existsSync(parent)) {
        const lines = collectFiles(parent, context.workspace);
        const listing = lines.length > 0 ? lines.join('\n') : '(empty directory)';
        let label: string;
        try {
          label = relative(context.workspace, parent) || '(workspace root)';
        } catch {
          label = '(workspace root)';
        }
        return wrapResult(`File not found: ${path}\nNearby files in ${label}:\n${listing}`);
      }
      return wrapResult(`File not found: ${path}`);
    }
    return wrapResult(readFileSync(full, 'utf-8'));
  }
}
