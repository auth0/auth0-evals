/**
 * The name of the tool.
 */
export type ToolName =
  | 'read_file'
  | 'list_files'
  | 'write_file'
  | 'run_command'
  | 'ask_user'
  | 'fetch_url'
  | 'finish_task'
  | 'list_skill_files'
  | 'read_skill_file';

/**
 * Defines the base types and interfaces for tools used in the agent evaluation framework.
 */
export interface ToolContext {
  workspace: string;
  credentials: Record<string, string>;
}

/**
 * The result of a tool execution, returned to the agent.
 * - result: string - the main output of the tool, to be returned to the agent.
 * - isDoc: boolean - whether it represents a documentation lookup.
 * - isInterrupt: boolean - whether it represents an interruption.
 * - isError: boolean - whether it represents an error.
 */
export type ToolResult = [result: string, isDoc: boolean, isInterrupt: boolean, isError: boolean];

/**
 * Interface that all tools must implement.
 * Each tool has a name and a run method that takes a context and arguments, and returns a ToolResult.
 */
export interface Tool {
  /**
   * The unique name of the tool, used to identify it when the agent calls it.
   */
  readonly name: ToolName;

  /**
   * Executes the tool with the given context and arguments, returning a ToolResult.
   * @param context - the execution context, including workspace and credentials.
   * @param args - a record of arguments specific to the tool's functionality.
   * @returns a ToolResult tuple containing the result string and flags for documentation, interruption, and error status.
   */
  run(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}
