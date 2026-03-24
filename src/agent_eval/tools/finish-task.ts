import { Tool, ToolContext, ToolName, ToolResult } from './base.js';

function wrapResult(message: string): ToolResult {
  return [message, false, false, false];
}

/**
 * FinishTaskTool allows the agent to signal that it has completed the task.
 * It takes an optional summary argument that can be used to provide a final message or summary of the task.
 */
export class FinishTaskTool implements Tool {
  name: ToolName = 'finish_task';

  run(_context: ToolContext, args: Record<string, unknown>): ToolResult {
    return wrapResult((args.summary as string) ?? 'Task complete.');
  }
}
