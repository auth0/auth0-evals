import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInside } from '../path-utils.js';
import { Tool, ToolContext, ToolName, ToolResult } from './base.js';

function wrapResult(message: string): ToolResult {
  return [message, false, false, false];
}

/**
 * WriteFileTool allows the agent to write content to a file within the workspace.
 * It takes a relative path and content as arguments and writes the content to the specified file.
 * If the path is invalid or outside the workspace, it returns an appropriate error message.
 */
export class WriteFileTool implements Tool {
  name: ToolName = 'write_file';

  run(context: ToolContext, args: Record<string, unknown>): ToolResult {
    const path = args.path as string;

    if (!path?.trim()) {
      throw new Error('write_file requires a file path.');
    }

    const content = args.content as string;

    let full: string;
    try {
      full = resolveInside(context.workspace, path);
    } catch {
      return wrapResult('Access denied: path is outside workspace');
    }
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
    return wrapResult(`Written: ${path} (${content.length} chars)`);
  }
}
