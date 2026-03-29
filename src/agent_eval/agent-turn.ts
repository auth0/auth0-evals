/**
 * Per-turn processing for the ReAct agent runner.
 *
 * Responsible for tool call normalization, classification,
 * and execution of the tool call inner loop within each agent turn.
 */

import { estimateCost } from '../config/costs.js';
import { ToolExecutor } from './tools-executor/index.js';
import { isBedrockModel } from './agent-model.js';
import { buildToolResultMessage } from './agent-messages.js';
import type { RunRecord, ToolCallRecord, TurnMetric, FinishReason, ActionType, ErrorCategory } from './agent.js';

/**
 * Parses XML tool calls from the message content, specifically for Bedrock models that may use this format instead of structured JSON tool_calls.
 * It looks for <tool_call>...</tool_call> blocks, extracts the JSON content, and builds ToolCallEntry objects.
 * @param content The message content string to parse for XML tool calls.
 * @returns An array of ToolCallEntry objects extracted from the XML content. If no valid tool calls are found, returns an empty array.
 */
export function parseXmlToolCalls(content: string): ToolCallEntry[] {
  const cutoff = content.indexOf('<tool_result>');
  const text = cutoff !== -1 ? content.slice(0, cutoff) : content;

  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const calls: ToolCallEntry[] = [];
  let i = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    try {
      // Claude (Bedrock) uses "input"; some variants use "parameters".
      // Fall through all known keys before defaulting to {}.
      const body = JSON.parse(match[1]!) as {
        name?: string;
        arguments?: Record<string, unknown>;
        input?: Record<string, unknown>;
        parameters?: Record<string, unknown>;
      };
      const args = body.arguments ?? body.input ?? body.parameters ?? {};
      calls.push({
        id: `xml_call_${i}`,
        type: 'function',
        function: {
          name: body.name ?? '',
          arguments: JSON.stringify(args),
        },
      });
      i++;
    } catch {
      // skip malformed blocks
    }
  }

  return calls;
}

/**
 * Normalizes tool arguments for common tools by mapping known aliases to standard argument names.
 * @param name The name of the tool being called.
 * @param args The original arguments for the tool call, which may contain aliases.
 * @returns A new arguments object with normalized keys for known tools, or the original arguments if no normalization is needed.
 *
 */
export function normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (['read_file', 'list_files', 'write_file'].includes(name) && !('path' in args)) {
    for (const alias of ['filename', 'file_path', 'filepath', 'file']) {
      if (alias in args) {
        return { ...args, path: args[alias] };
      }
    }
  }
  if (name === 'run_command' && !('command' in args)) {
    for (const alias of ['cmd', 'shell_command', 'bash_command']) {
      if (alias in args) {
        return { ...args, command: args[alias] };
      }
    }
  }
  return args;
}

/**
 * Summarizes the key argument(s) of a tool call for logging purposes, based on the tool type.
 * @param toolName The name of the tool being called.
 * @param args The arguments for the tool call.
 * @returns A string summarizing the key argument(s) of the tool call.
 */
export function summariseArgs(toolName: string, args: Record<string, unknown>): string {
  if (['read_file', 'list_files', 'write_file'].includes(toolName)) {
    const path = (args.path as string) ?? '';
    const suffix = 'content' in args ? `, ${((args.content as string) ?? '').length} chars` : '';
    return `"${path}"${suffix}`;
  }
  if (toolName === 'run_command') {
    return `"${((args.command as string) ?? '').slice(0, 60)}"`;
  }
  if (toolName === 'fetch_url') {
    return `"${((args.url as string) ?? '').slice(0, 60)}"`;
  }
  if (toolName === 'search_auth0_docs') {
    return `"${((args.query as string) ?? '').slice(0, 60)}"`;
  }
  if (toolName === 'ask_user') {
    return `"${((args.question as string) ?? '').slice(0, 60)}"`;
  }
  if (toolName === 'finish_task') {
    return `"${((args.summary as string) ?? '').slice(0, 60)}"`;
  }
  return JSON.stringify(args).slice(0, 80);
}

/**
 * Extract the primary identifying argument from a tool call's name and arguments, which is used for retry detection.
 * The primary argument is determined based on the tool type:
 * - For file-related tools (read_file, list_files, write_file), it's the 'path' argument.
 * - For run_command, it's the 'command' argument (truncated to 80 chars).
 * - For fetch_url, it's the 'url' argument.
 * - For ask_user, it's the 'question' argument (truncated to 80 chars).
 * - For other tools, it defaults to a JSON string of all arguments (truncated to 80 chars).
 * @param name The name of the tool being called.
 * @param args The arguments for the tool call.
 * @returns The primary identifying argument for the tool call.
 */
export function primaryArg(name: string, args: Record<string, unknown>): string {
  if (name === 'read_file' || name === 'list_files' || name === 'write_file') {
    return (args.path ?? args.filename ?? args.file_path ?? '') as string;
  }
  if (name === 'run_command') {
    return ((args.command as string) ?? '').slice(0, 80);
  }
  if (name === 'fetch_url') {
    return (args.url as string) ?? '';
  }
  if (name === 'ask_user') {
    return ((args.question as string) ?? '').slice(0, 80);
  }
  return JSON.stringify(args).slice(0, 80);
}

const TOOL_ACTION_TYPES: Record<string, ActionType> = {
  ask_user: 'Interruption',
  fetch_url: 'Discovery',
  read_file: 'Discovery',
  list_files: 'Discovery',
  write_file: 'Implementation',
  run_command: 'Implementation',
  finish_task: 'Implementation',
  search_auth0_docs: 'Discovery',
};

/**
 * Classify the type of action represented by a tool call based on its name and whether it caused an error.
 *
 * @param name The name of the tool being called.
 * @param causedError A boolean indicating whether the tool call resulted in an error.
 * @returns The classified ActionType for the tool call.
 */
export function classifyActionType(name: string, causedError: boolean): ActionType {
  if (causedError) {
    return 'Error';
  }

  return TOOL_ACTION_TYPES[name] ?? 'unknown';
}

/**
 * Classify an error result string into a category.
 *
 * @param result  The error message string to classify.
 * @returns The category of the error.
 *
 * @remarks The error classification looks for key phrases in the error message to determine the category of error that occurred.
 * This is used for better analysis and understanding of the types of errors the agent encounters during tool execution.
 */
export function classifyErrorCategory(result: string): ErrorCategory {
  const r = result.toLowerCase();
  if (['not found', 'no such file', 'does not exist', 'file not found'].some((p) => r.includes(p))) return 'not_found';
  if (['timed out', 'timeout', 'deadline'].some((p) => r.includes(p))) return 'timeout';
  if (['permission denied', 'access denied', 'forbidden', '403'].some((p) => r.includes(p))) return 'permission';
  if (['401', 'unauthorized', 'unauthenticated'].some((p) => r.includes(p))) return 'auth';
  if (['connection', 'network', 'could not fetch', 'urlopen error', 'name or service'].some((p) => r.includes(p)))
    return 'network';
  if (['syntaxerror', 'syntax error', 'unexpected token', 'json', 'parse error', 'decode'].some((p) => r.includes(p)))
    return 'syntax';
  return 'unknown';
}

/**
 * Detect if the current tool call is a retry of a previous call that caused an error.
 *
 * @param toolCalls The history of tool calls to check against.
 * @param toolName The name of the tool being called.
 * @param toolArgs The arguments for the current tool call.
 * @returns True if the current call is a retry of a previous call that caused an error, otherwise false.
 *
 * @remarks Retry is determined by checking the history of tool calls for any prior call with the same tool name and primary argument that resulted in an error.
 * The primary argument is extracted based on the tool type (e.g., 'path' for file operations, 'command' for run_command, etc.) to identify retries of the same logical operation,
 * even if other arguments differ.
 */
export function detectRetry(toolCalls: ToolCallRecord[], toolName: string, toolArgs: Record<string, unknown>): boolean {
  const thisPrimary = primaryArg(toolName, toolArgs);
  const lastSame = toolCalls.findLast(
    (prev) => prev.name === toolName && primaryArg(prev.name, prev.args) === thisPrimary,
  );
  return lastSame?.causedError === true;
}

export interface ToolCallEntry {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/**
 * Normalizes tool calls from a model's message into a uniform ToolCallEntry array.
 * Handles standard tool_calls, Gemini function_call normalization, and Bedrock XML fallback.
 */
export function normalizeTurnToolCalls(model: string, message: Record<string, unknown>): ToolCallEntry[] {
  let toolCalls = (message?.tool_calls as ToolCallEntry[]) || [];

  // Gemini: normalise function_call into tool_calls format
  if (!toolCalls.length && message?.function_call) {
    const fc = message.function_call as Record<string, unknown>;
    toolCalls = [
      {
        id: 'fc_0',
        type: 'function',
        function: {
          name: fc.name as string,
          arguments: (fc.arguments as string) ?? '{}',
        },
      },
    ];
  }

  // XML fallback for Bedrock models only — other models use standard JSON tool_calls
  if (!toolCalls.length && isBedrockModel(model)) {
    const xmlCalls = parseXmlToolCalls((message?.content as string) ?? '');
    if (xmlCalls.length) {
      toolCalls = xmlCalls;
    }
  }

  return toolCalls;
}

/**
 * Builds a TurnMetric object for the current turn.
 */
export function buildTurnMetric(
  turn: number,
  model: string,
  turnInput: number,
  turnOutput: number,
  llmLatency: number,
  choice: Record<string, unknown>,
  toolCallCount: number,
): TurnMetric {
  return {
    turn: turn + 1,
    inputTokens: turnInput,
    outputTokens: turnOutput,
    llmLatency,
    finishReason: (choice?.finish_reason as FinishReason) ?? 'unknown',
    toolCallCount,
    costUsd: Math.round(estimateCost(model, turnInput, turnOutput) * 10_000) / 10_000,
  };
}

/**
 * Executes all tool calls for a single turn, logging output, building ToolCallRecords,
 * pushing result messages onto history, and detecting finish_task.
 *
 * @returns true if finish_task was invoked (signals the agent loop to break).
 */
export async function executeToolCalls(
  toolCalls: ToolCallEntry[],
  turn: number,
  model: string,
  executor: ToolExecutor,
  messages: unknown[],
  record: RunRecord,
): Promise<boolean> {
  for (const tc of toolCalls) {
    const fn = tc.function;
    const toolName = fn.name;
    let toolArgs: Record<string, unknown>;
    try {
      toolArgs = JSON.parse(fn.arguments);
    } catch {
      toolArgs = {};
    }

    toolArgs = normalizeToolArgs(toolName, toolArgs);

    process.stdout.write(`  [${turn + 1}] ${toolName}(${summariseArgs(toolName, toolArgs)}) … `);

    const tStart = Date.now() / 1000;
    const [result, isDoc, isInterrupt, isError] = await executor.execute(toolName, toolArgs);
    const tEnd = Date.now() / 1000;

    const elapsed = ((tEnd - tStart) * 1000).toFixed(0);
    if (isError) {
      const preview = result.slice(0, 120).replace(/\n/g, ' ');
      console.log(`✗ (${elapsed}ms) ${preview}`);
      record.providerErrors.push(`${toolName}: ${result}`);
    } else {
      const preview = result.slice(0, 80).replace(/\n/g, ' ');
      console.log(`✓ (${elapsed}ms)${preview ? ` → ${preview}` : ''}`);
    }

    const isRetry = detectRetry(record.toolCalls, toolName, toolArgs);
    const recovered = isRetry && !isError;

    const toolCall: ToolCallRecord = {
      name: toolName,
      args: toolArgs,
      result,
      startTime: tStart,
      endTime: tEnd,
      isDocLookup: isDoc,
      isInterruption: isInterrupt,
      causedError: isError,
      actionType: classifyActionType(toolName, isError),
      isRetry,
      recoveredFromError: recovered,
    };

    // Only when there is an error do we classify the error category; for successful calls, errorCategory is undefined.
    if (isError) {
      toolCall.errorCategory = classifyErrorCategory(result);
    }

    record.toolCalls.push(toolCall);

    messages.push(buildToolResultMessage(model, tc.id, toolName, result));

    if (toolName === 'finish_task') {
      record.finalSummary = (toolArgs.summary as string) ?? result;
      record.status = 'success';
      console.log(`\n[Agent] Done. Summary: ${record.finalSummary.slice(0, 200)}`);
      return true;
    }
  }

  return false;
}
