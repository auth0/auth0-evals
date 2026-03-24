import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { Tool, ToolName, ToolResult } from '../tools/base';
import { ALL_TOOLS } from '../tools';

/**
 * ToolExecutor is responsible for executing tools based on their name and provided arguments.
 * It maintains a workspace and credentials that can be used by the tools during execution.
 */
export class ToolExecutor {
  readonly #workspace: string;
  readonly #credentials: Record<string, string>;
  readonly #tools: Tool[] = ALL_TOOLS;

  constructor(workspace: string, credentials: Record<string, string> = {}) {
    try {
      this.#workspace = realpathSync(workspace);
    } catch {
      this.#workspace = resolve(workspace);
    }
    this.#credentials = credentials;
  }

  /**
   * Executes a tool by its name with the given arguments.
   * @param name The name of the tool to execute.
   * @param args The arguments to pass to the tool during execution.
   * @returns A tuple containing the tool's output, a boolean indicating isDoc, a boolean indicating if there was an interruption, and a boolean indicating if there was an error.
   */
  execute(name: ToolName, args: Record<string, unknown>): ToolResult {
    try {
      const tool = this.#tools.find((t) => t.name === name);

      if (tool) {
        const toolContext = { workspace: this.#workspace, credentials: this.#credentials };
        return tool.run(toolContext, args);
      }

      return [`Unknown tool: ${name}`, false, false, true];
    } catch (e) {
      return [`Error executing ${name}: ${e}`, false, false, true];
    }
  }
}
