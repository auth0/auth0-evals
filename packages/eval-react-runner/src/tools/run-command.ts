import { execSync } from 'node:child_process';
import { toolResult, errorResult } from './base.js';
import type { Tool, ToolContext, ToolName, ToolResult } from './base.js';

/**
 * RunCommandTool allows the agent to execute a shell command in the workspace.
 * It takes a command as an argument and executes it using Node's child_process.execSync function.
 * The tool captures both stdout and stderr, returning their combined output.
 * If the command execution fails (e.g., due to a non-zero exit code), it returns the error message along with any output produced before the failure.
 */
export class RunCommandTool implements Tool {
  name: ToolName = 'run_command';

  async run(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    try {
      const stdout = execSync(command, {
        cwd: context.workspace,
        timeout: 180_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return toolResult((stdout as string).slice(-2000) || '(no output)');
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const out = (err.stdout ?? '').slice(-2000);
      const errText = (err.stderr ?? err.message ?? '').slice(-1000);
      return errorResult((out + (errText ? '\n' + errText : '')).trim() || '(no output)');
    }
  }
}
