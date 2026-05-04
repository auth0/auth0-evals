import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInside, validatePathFormat } from '@a0/eval';
import type { Tool, ToolContext, ToolName, ToolResult } from './base.js';

function wrapResult(message: string, isError: boolean = false): ToolResult {
  return [message, false, false, isError];
}

/**
 * WriteFileTool allows the agent to write content to a file within the workspace.
 * It takes a relative path and content as arguments and writes the content to the specified file.
 * If the path is invalid or outside the workspace, it returns an appropriate error message.
 */
export class WriteFileTool implements Tool {
  name: ToolName = 'write_file';

  async run(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const path = args.path as string;

    if (!path?.trim()) {
      throw new Error('write_file requires a file path.');
    }

    const formatError = validatePathFormat(path);
    if (formatError) {
      return wrapResult(formatError, true);
    }

    const content = args.content as string;

    let full: string;
    try {
      full = resolveInside(context.workspace, path);
    } catch {
      return wrapResult('Access denied: path is outside workspace', true);
    }
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
    return wrapResult(`Written: ${path} (${content.length} chars)`);
  }
}
