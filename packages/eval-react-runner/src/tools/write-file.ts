import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInside, validatePathFormat } from '@a0/eval';
import { toolResult, errorResult } from './base.js';
import type { Tool, ToolContext, ToolName, ToolResult } from './base.js';

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
      return errorResult(formatError);
    }

    const content = args.content as string;

    let full: string;
    try {
      full = resolveInside(context.workspace, path);
    } catch {
      return errorResult('Access denied: path is outside workspace');
    }
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
    return toolResult(`Written: ${path} (${content.length} chars)`);
  }
}
