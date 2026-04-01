/**
 * ReAct agent runner with full instrumentation.
 *
 * Runs an LLM agent against a coding task using the tool-calling API.
 * Every tool call, its timing, doc lookups, and interruptions are recorded
 * in a RunRecord for downstream scoring and report generation.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { estimateCost } from '../config/costs.js';
import { BedrockToolConfigError, LlmApiError } from '../errors.js';
import { withRetry } from '../utils/retry.js';
import { BASE_URL, CLAUDE_EFFORT_MODELS, MAX_TURNS } from '../config/settings.js';
import { isBedrockModel, isGeminiModel } from './agent-model.js';
import { buildToolDefinitions } from './tools/index.js';
import { McpConfig, ToolExecutor } from './tools-executor/index.js';
import { ToolName } from './tools/base.js';
import { buildInitialMessages, buildToolResultMessage } from './agent-messages.js';
import {
  type FinishReason,
  type RunRecord,
  type ToolCallRecord,
  classifyActionType,
  classifyErrorCategory,
  detectRetry,
} from './agent-types.js';

function makeRunRecord(taskName: string, model: string, workspace: string): RunRecord {
  return {
    taskName,
    model,
    sessionId: Math.random().toString(36).slice(2, 10),
    startTime: 0,
    endTime: 0,
    toolCalls: [],
    turnMetrics: [],
    providerErrors: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    status: 'running',
    finalSummary: '',
    workspace,
  };
}

// ── LLM client ───────────────────────────────────────────────────────────────

export async function llmCall(
  apiKey: string,
  model: string,
  messages: unknown[],
  tools: unknown[],
): Promise<Record<string, unknown>> {
  const inputText = JSON.stringify(messages);
  const inputSizeKb = Buffer.byteLength(inputText, 'utf-8') / 1024;

  console.log(`\n[LLM API] Calling remote API: ${BASE_URL}/chat/completions`);
  console.log(`[LLM API] Model: ${model}`);
  console.log(`[LLM API] Messages: ${messages.length} in history (~${inputSizeKb.toFixed(1)} KB)`);
  console.log('[LLM API] Waiting for response...');

  const callStart = Date.now();

  let body: Record<string, unknown>;
  if (isBedrockModel(model)) {
    // output_config.effort: medium is only supported by specific Claude models (Opus 4.6, Sonnet 4.6, Opus 4.5).
    // For other Claude/Bedrock models, omit it to avoid unexpected behaviour.
    const outputConfig = CLAUDE_EFFORT_MODELS.has(model) ? { output_config: { effort: 'medium' } } : {};
    body = { model, messages, tools, tool_choice: 'auto', temperature: 0.0, ...outputConfig };
  } else if (isGeminiModel(model)) {
    const functions = (tools as { function: unknown }[]).map((t) => t.function);
    body = { model, messages, functions, function_call: 'auto', temperature: 0.0 };
  } else {
    body = { model, messages, tools, tool_choice: 'required', temperature: 0.0 };
  }

  const responseData = await withRetry(async () => {
    const attemptStart = Date.now();
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });

    if (!resp.ok) {
      const bodyText = await resp.text();
      const attemptDuration = (Date.now() - attemptStart) / 1000;
      console.log(`[LLM API] ❌ API error ${resp.status} after ${attemptDuration.toFixed(2)}s`);
      console.log(`[LLM API] 💥 Error: ${bodyText.slice(0, 200)}`);

      if (bodyText.includes('toolConfig') && bodyText.includes('BedrockException')) {
        throw new BedrockToolConfigError(model);
      }
      throw new LlmApiError(resp.status, bodyText);
    }

    return (await resp.json()) as Record<string, unknown>;
  });

  const callDuration = (Date.now() - callStart) / 1000;
  const usage = (responseData.usage as Record<string, number>) ?? {};
  const [inputTokens, outputTokens] = extractTokens(usage);

  console.log(`[LLM API] Response received (${callDuration.toFixed(2)}s)`);
  console.log(`[LLM API] Tokens: ${inputTokens} in / ${outputTokens} out`);

  const message = (responseData.choices as Record<string, unknown>[])?.[0]?.message as Record<string, unknown>;
  const toolCalls = message?.tool_calls;
  const functionCall = message?.function_call;

  if (toolCalls) {
    console.log(`[LLM API] Agent requested ${(toolCalls as unknown[]).length} tool call(s)`);
  } else if (functionCall) {
    console.log(`[LLM API] Agent requested function call: ${(functionCall as Record<string, unknown>).name}`);
  } else {
    const contentPreview = ((message?.content as string) ?? '').slice(0, 80);
    console.log(`[LLM API] Agent finished: "${contentPreview}"`);
  }

  return responseData;
}

// ── Agent runner ──────────────────────────────────────────────────────────────

const AUTH0_MCP: McpConfig = {
  url: 'https://auth0.com/docs/mcp',
  name: 'auth0-eval-agent',
  version: '1.0.0',
};

export interface TaskDefinition {
  name: string;
  agentSystemPrompt: string;
  userPrompt: string;
}

export async function runAgent(
  apiKey: string,
  model: string,
  task: TaskDefinition,
  workspace: string,
  credentials: Record<string, string> = {},
  tools: string[] = [],
): Promise<RunRecord> {
  if (isBedrockModel(model)) {
    console.log(`\n[Agent] Model '${model}' is Bedrock-routed — using XML tool-call fallback mode`);
  } else if (isGeminiModel(model)) {
    console.log(`\n[Agent] Model '${model}' is Gemini — using functions/function_call API`);
  }

  const record = makeRunRecord(task.name, model, workspace);
  const executor = new ToolExecutor(workspace, credentials);

  try {
    let mcpToolDefs: unknown[] = [];
    if (tools.includes('mcp')) {
      const { tools: toolDefs, toolNames } = await executor.initMcp(AUTH0_MCP);
      mcpToolDefs = toolDefs;
      if (toolNames.length > 0) {
        console.log(`[Agent] MCP tools registered with LLM: ${toolNames.join(', ')}`);
      }
    }

    const messages = buildInitialMessages(task, tools, mcpToolDefs, workspace);

    record.startTime = Date.now() / 1000;
    console.log(`\n[Agent] Starting task: ${task.name}`);
    console.log(`[Agent] Model: ${model} | Workspace: ${workspace}\n`);

    let taskFinishedOuter = false;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const tLlmStart = Date.now() / 1000;
      const response = await llmCall(apiKey, model, messages, buildToolDefinitions(tools, mcpToolDefs));
      const llmLatency = Date.now() / 1000 - tLlmStart;

      const usage = (response.usage as Record<string, number>) ?? {};
      const [turnInput, turnOutput] = extractTokens(usage);
      record.inputTokens += turnInput;
      record.outputTokens += turnOutput;

      const choice = (response.choices as Record<string, unknown>[])?.[0];
      const message = choice?.message as Record<string, unknown>;

      messages.push(message);

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

      // XML fallback for Bedrock models only — other models use standard JSON tool_calls.
      // Only set usedXmlFallback when XML calls are actually found; if the model returned
      // standard tool_calls (even for Bedrock via litellm) we must use role:"tool" results
      // so litellm can map them to Bedrock tool_result blocks.
      let usedXmlFallback = false;
      if (!toolCalls.length && isBedrockModel(model)) {
        const xmlCalls = parseXmlToolCalls((message?.content as string) ?? '');
        if (xmlCalls.length) {
          toolCalls = xmlCalls;
          usedXmlFallback = true;
        }
      }

      record.turnMetrics.push({
        turn: turn + 1,
        inputTokens: turnInput,
        outputTokens: turnOutput,
        llmLatency: llmLatency,
        finishReason: (choice?.finish_reason as FinishReason) ?? 'unknown',
        toolCallCount: toolCalls.length,
        costUsd: Math.round(estimateCost(model, turnInput, turnOutput) * 10_000) / 10_000,
      });

      if (!toolCalls.length) {
        record.finalSummary = (message?.content as string) ?? '';
        record.status = 'success';
        console.log(`\n[Agent] Done. Final message: ${record.finalSummary.slice(0, 200)}`);
        taskFinishedOuter = true;
        break;
      }

      let taskFinished = false;
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
        const [result, isDoc, isInterrupt, isError] = await executor.execute(toolName as ToolName, toolArgs);
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

        messages.push(buildToolResultMessage(model, tc.id, toolName, result, usedXmlFallback));

        if (toolName === 'finish_task') {
          record.finalSummary = (toolArgs.summary as string) ?? result;
          record.status = 'success';
          taskFinished = true;
          console.log(`\n[Agent] Done. Summary: ${record.finalSummary.slice(0, 200)}`);
        }
      }

      if (taskFinished) {
        taskFinishedOuter = true;
        break;
      }
    }

    if (!taskFinishedOuter && record.status === 'running') {
      record.status = 'failure';
      console.log('[Agent] Max turns reached without completion.');
    }

    record.endTime = Date.now() / 1000;
    record.costUsd = estimateCost(model, record.inputTokens, record.outputTokens);
    return record;
  } finally {
    await executor.close();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ToolCallEntry {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export function extractTokens(usage: Record<string, number>): [number, number] {
  let inputTokens = usage.prompt_tokens;
  if (inputTokens === undefined) inputTokens = usage.input_tokens ?? 0;
  let outputTokens = usage.completion_tokens;
  if (outputTokens === undefined) outputTokens = usage.output_tokens ?? 0;
  return [inputTokens, outputTokens];
}

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
 * Parses XML tool calls from Bedrock model responses.
 *
 * Two XML dialects are in use depending on the proxy/model configuration:
 *
 * Format 1 — JSON body wrapped in <tool_call>:
 *   <tool_call>{"name":"read_file","input":{"path":"foo.ts"}}</tool_call>
 *
 * Format 2 — Anthropic <invoke> / <parameter> tags (used by claude-4-6-sonnet via litellm):
 *   <function_calls>
 *     <invoke name="read_file">
 *       <parameter name="path">foo.ts</parameter>
 *     </invoke>
 *   </function_calls>
 *
 * Format 1 is tried first; Format 2 is the fallback.
 */
export function parseXmlToolCalls(content: string): ToolCallEntry[] {
  const cutoff = content.indexOf('<tool_result>');
  const text = cutoff !== -1 ? content.slice(0, cutoff) : content;

  return parseToolCallBlocks(text) ?? parseInvokeBlocks(text);
}

/** Format 1: <tool_call>{ "name": "...", "input": {...} }</tool_call> */
function parseToolCallBlocks(text: string): ToolCallEntry[] | null {
  const calls: ToolCallEntry[] = [];
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    try {
      const body = JSON.parse(match[1]!) as {
        name?: string;
        arguments?: Record<string, unknown>;
        input?: Record<string, unknown>;
        parameters?: Record<string, unknown>;
      };
      const args = body.arguments ?? body.input ?? body.parameters ?? {};
      calls.push(makeToolCallEntry(body.name ?? '', args, calls.length));
    } catch {
      // skip malformed blocks
    }
  }

  return calls.length > 0 ? calls : null;
}

/** Format 2: <invoke name="..."><parameter name="...">value</parameter></invoke> */
function parseInvokeBlocks(text: string): ToolCallEntry[] {
  const calls: ToolCallEntry[] = [];
  const invokePattern = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
  const paramPattern = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
  let match: RegExpExecArray | null;

  while ((match = invokePattern.exec(text)) !== null) {
    const name = match[1]!;
    const args: Record<string, unknown> = {};
    let p: RegExpExecArray | null;
    paramPattern.lastIndex = 0;
    while ((p = paramPattern.exec(match[2]!)) !== null) {
      args[p[1]!] = p[2]!.trim();
    }
    calls.push(makeToolCallEntry(name, args, calls.length));
  }

  return calls;
}

function makeToolCallEntry(name: string, args: Record<string, unknown>, index: number): ToolCallEntry {
  return {
    id: `xml_call_${index}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

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

// ── Workspace context builder (Layer 2) ──────────────────────────────────────

export function setupWorkspace(scaffold: Record<string, string>): string {
  const workspace = mkdtempSync(join(tmpdir(), 'auth0_eval_'));
  for (const [relPath, content] of Object.entries(scaffold)) {
    const dest = join(workspace, relPath);
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, content, 'utf-8');
  }
  return workspace;
}

export function cleanupWorkspace(workspace: string): void {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[Cleanup] Failed to remove workspace ${workspace}: ${e}`);
  }
}
