/**
 * ReAct agent runner with full instrumentation.
 *
 * Runs an LLM agent against a coding task using the tool-calling API.
 * Every tool call, its timing, doc lookups, and interruptions are recorded
 * in a RunRecord for downstream scoring and report generation.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { estimateCost } from '../config/costs.js';
import { isPathInside, resolveInside } from './path-utils.js';
import { BedrockToolConfigError, LlmApiError } from '../errors.js';
import { BASE_URL, BEDROCK_MODELS, GEMINI_MODELS, MAX_TURNS } from '../config/settings.js';

export function isBedrockModel(model: string): boolean {
  return BEDROCK_MODELS.some((prefix) => model.includes(prefix));
}

export function isGeminiModel(model: string): boolean {
  return GEMINI_MODELS.some((prefix) => model.startsWith(prefix));
}

// ── Data model ────────────────────────────────────────────────────────────────

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
  startTime: number;
  endTime: number;
  isDocLookup: boolean;
  isInterruption: boolean;
  causedError: boolean;
}

export interface RunRecord {
  taskName: string;
  model: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  toolCalls: ToolCallRecord[];
  providerErrors: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: string;
  finalSummary: string;
  workspace: string;
}

function makeRunRecord(taskName: string, model: string, workspace: string): RunRecord {
  return {
    taskName,
    model,
    sessionId: Math.random().toString(36).slice(2, 10),
    startTime: 0,
    endTime: 0,
    toolCalls: [],
    providerErrors: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    status: 'running',
    finalSummary: '',
    workspace,
  };
}

// Maximum number of files to include in a directory listing.
export const MAX_LISTED_FILES = 200;

// ── Tool definitions sent to the LLM ─────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to a file within the workspace' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List all files under a directory in the project workspace. ' +
        'Pass an empty string to list the entire workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Relative path to a directory within the workspace, ' +
              'or an empty string for the workspace root.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write or overwrite a file in the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command inside the project workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch the contents of a documentation URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Ask the user for information you cannot determine yourself ' +
        '(e.g. credentials, tenant domain, client IDs, dashboard URLs). ' +
        'Only use this when you truly cannot proceed without human input.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_task',
      description:
        'Signal that the task is complete. Call this when all required ' +
        'files have been written and no further changes are needed.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief summary of what was done' },
        },
        required: ['summary'],
      },
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

export class ToolExecutor {
  private workspace: string;
  private credentials: Record<string, string>;

  constructor(workspace: string, credentials: Record<string, string> = {}) {
    try {
      this.workspace = realpathSync(workspace);
    } catch {
      this.workspace = resolve(workspace);
    }
    this.credentials = credentials;
  }

  execute(name: string, args: Record<string, unknown>): [string, boolean, boolean, boolean] {
    const normArgs = normalizeToolArgs(name, args);
    try {
      switch (name) {
        case 'read_file':
          return [this.readFile(normArgs.path as string), false, false, false];
        case 'list_files':
          return [this.listFiles(normArgs.path as string), false, false, false];
        case 'write_file':
          return [this.writeFile(normArgs.path as string, normArgs.content as string), false, false, false];
        case 'run_command':
          return [this.runCommand(normArgs.command as string), false, false, false];
        case 'fetch_url':
          return [this.fetchUrl(normArgs.url as string), true, false, false];
        case 'ask_user':
          return [this.askUser(normArgs.question as string), false, true, false];
        case 'finish_task':
          return [(normArgs.summary as string) ?? 'Task complete.', false, false, false];
        default:
          return [`Unknown tool: ${name}`, false, false, true];
      }
    } catch (e) {
      return [`Error executing ${name}: ${e}`, false, false, true];
    }
  }

  private readFile(path: string): string {
    let full: string;
    try {
      full = resolveInside(this.workspace, path);
    } catch {
      return 'Access denied: path is outside workspace';
    }
    if (existsSync(full) && statSync(full).isDirectory()) {
      return `Path is a directory: '${path}'. Use list_files to list its contents.`;
    }
    if (!existsSync(full)) {
      const parent = join(full, '..');
      if (existsSync(parent)) {
        const lines = collectFiles(parent, this.workspace);
        const listing = lines.length > 0 ? lines.join('\n') : '(empty directory)';
        let label: string;
        try {
          label = relative(this.workspace, parent) || '(workspace root)';
        } catch {
          label = '(workspace root)';
        }
        return `File not found: ${path}\nNearby files in ${label}:\n${listing}`;
      }
      return `File not found: ${path}`;
    }
    return readFileSync(full, 'utf-8');
  }

  private listFiles(path: string): string {
    let full: string;
    try {
      full = resolveInside(this.workspace, path);
    } catch {
      return 'Access denied: path is outside workspace';
    }
    if (!existsSync(full)) {
      return `Directory not found: '${path}'`;
    }
    if (!statSync(full).isDirectory()) {
      return `Path is a file: '${path}'. Use read_file to read its contents.`;
    }
    const lines = collectFiles(full, this.workspace);
    const listing = lines.length > 0 ? lines.join('\n') : '(empty directory)';
    const label = path || '(workspace root)';
    return `Directory listing for ${label}:\n${listing}`;
  }

  private writeFile(path: string, content: string): string {
    let full: string;
    try {
      full = resolveInside(this.workspace, path);
    } catch {
      return 'Access denied: path is outside workspace';
    }
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
    return `Written: ${path} (${content.length} chars)`;
  }

  private runCommand(command: string): string {
    try {
      const stdout = execSync(command, {
        cwd: this.workspace,
        timeout: 60_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return (stdout as string).slice(-2000) || '(no output)';
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const out = (err.stdout ?? '').slice(-2000);
      const errText = (err.stderr ?? err.message ?? '').slice(-1000);
      return (out + (errText ? '\n' + errText : '')).trim() || '(no output)';
    }
  }

  private fetchUrl(url: string): string {
    // Use execFileSync (no shell) with the URL embedded via JSON.stringify so
    // special characters in the URL cannot break out of the script string.
    try {
      const script = `
        fetch(${JSON.stringify(url)}, {headers: {'User-Agent': 'auth0-eval-agent/1.0'}, signal: AbortSignal.timeout(15000)})
          .then(r => r.text())
          .then(t => process.stdout.write(t.slice(0, 8000)))
          .catch(e => process.stdout.write('Error: ' + e.message));
      `;
      const result = execFileSync('node', ['-e', script], { encoding: 'utf-8', timeout: 20_000 });
      // Strip HTML tags
      const text = (result as string).replace(/<[^>]+>/g, ' ').replace(/\s{3,}/g, '\n');
      return text.slice(0, 3000).trim();
    } catch (e) {
      return `Could not fetch ${url}: ${e}`;
    }
  }

  private askUser(question: string): string {
    const lowerQ = question.toLowerCase();
    if (
      (lowerQ.includes('domain') || lowerQ.includes('tenant')) &&
      'domain' in this.credentials
    ) {
      return this.credentials.domain;
    }
    if (
      (lowerQ.includes('client id') ||
        lowerQ.includes('clientid') ||
        lowerQ.includes('client_id')) &&
      'client_id' in this.credentials
    ) {
      return this.credentials.client_id;
    }
    console.log(`\n[AGENT ASKING]: ${question}`);
    // In automated mode, return placeholder
    return '(no answer provided)';
  }
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
    body = { model, messages, temperature: 0.0 };
  } else if (isGeminiModel(model)) {
    const functions = (tools as { function: unknown }[]).map((t) => t.function);
    body = { model, messages, functions, function_call: 'auto', temperature: 0.0 };
  } else {
    body = { model, messages, tools, tool_choice: 'required', temperature: 0.0 };
  }

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
    const callDuration = (Date.now() - callStart) / 1000;
    console.log(`[LLM API] ❌ API error ${resp.status} after ${callDuration.toFixed(2)}s`);
    console.log(`[LLM API] 💥 Error: ${bodyText.slice(0, 200)}`);

    if (bodyText.includes('toolConfig') && bodyText.includes('BedrockException')) {
      throw new BedrockToolConfigError(model);
    }
    throw new LlmApiError(resp.status, bodyText);
  }

  const responseData = (await resp.json()) as Record<string, unknown>;
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
): Promise<RunRecord> {
  if (isBedrockModel(model)) {
    console.log(`\n[Agent] Model '${model}' is Bedrock-routed — using XML tool-call fallback mode`);
  } else if (isGeminiModel(model)) {
    console.log(`\n[Agent] Model '${model}' is Gemini — using functions/function_call API`);
  }

  const record = makeRunRecord(task.name, model, workspace);
  const executor = new ToolExecutor(workspace, credentials);

  const messages: unknown[] = [];
  if (task.agentSystemPrompt) {
    messages.push({ role: 'system', content: task.agentSystemPrompt });
  }
  messages.push({ role: 'user', content: task.userPrompt });

  record.startTime = Date.now() / 1000;
  console.log(`\n[Agent] Starting task: ${task.name}`);
  console.log(`[Agent] Model: ${model} | Workspace: ${workspace}\n`);

  let taskFinishedOuter = false;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await llmCall(apiKey, model, messages, TOOL_DEFINITIONS);

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

    // XML fallback for Bedrock models only — other models use standard JSON tool_calls
    if (!toolCalls.length && isBedrockModel(model)) {
      const xmlCalls = parseXmlToolCalls((message?.content as string) ?? '');
      if (xmlCalls.length) {
        toolCalls = xmlCalls;
      }
    }

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

      console.log(`  [${turn + 1}] ${toolName}(${summariseArgs(toolName, toolArgs)})`);

      const tStart = Date.now() / 1000;
      const [result, isDoc, isInterrupt, isError] = executor.execute(toolName, toolArgs);
      const tEnd = Date.now() / 1000;

      if (isError) {
        record.providerErrors.push(`${toolName}: ${result}`);
      }

      record.toolCalls.push({
        name: toolName,
        args: toolArgs,
        result,
        startTime: tStart,
        endTime: tEnd,
        isDocLookup: isDoc,
        isInterruption: isInterrupt,
        causedError: isError,
      });

      if (isBedrockModel(model)) {
        messages.push({ role: 'user', content: `[Result of ${toolName}]:\n${result}` });
      } else if (isGeminiModel(model)) {
        messages.push({ role: 'function', name: toolName, content: result });
      } else {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ToolCallEntry {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.nuxt', '__pycache__', '.venv', 'venv',
]);

export function collectFiles(root: string, relativeTo: string): string[] {
  // Use realpathSync to resolve symlinks in the workspace root itself (e.g. /var -> /private/var on macOS)
  let workspaceRoot: string;
  try {
    workspaceRoot = realpathSync(relativeTo);
  } catch {
    workspaceRoot = resolve(relativeTo);
  }

  const files: string[] = [];
  let truncated = false;

  function walk(dir: string): void {
    if (truncated) return;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) break;
      const fullPath = join(dir, entry.name);

      // Skip symlinked directories (followlinks=False equivalent)
      if (entry.isSymbolicLink()) {
        // Only include symlinked files if they resolve within workspace
        try {
          const realPath = realpathSync(fullPath);
          if (isPathInside(workspaceRoot, realPath) && statSync(fullPath).isFile()) {
            files.push(relative(relativeTo, fullPath).replace(/\\/g, '/'));
            if (files.length >= MAX_LISTED_FILES) {
              truncated = true;
            }
          }
        } catch {
          // skip broken symlinks or files resolving outside workspace
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        try {
          const realPath = realpathSync(fullPath);
          if (isPathInside(workspaceRoot, realPath)) {
            files.push(relative(relativeTo, fullPath).replace(/\\/g, '/'));
            if (files.length >= MAX_LISTED_FILES) {
              truncated = true;
            }
          }
        } catch {
          // skip
        }
      }
    }
  }

  walk(root);
  files.sort();
  if (truncated) {
    files.push(`… (truncated at ${MAX_LISTED_FILES} files)`);
  }
  return files;
}

export function extractTokens(usage: Record<string, number>): [number, number] {
  let inputTokens = usage.prompt_tokens;
  if (inputTokens === undefined) inputTokens = usage.input_tokens ?? 0;
  let outputTokens = usage.completion_tokens;
  if (outputTokens === undefined) outputTokens = usage.output_tokens ?? 0;
  return [inputTokens, outputTokens];
}

export function normalizeToolArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
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

export function parseXmlToolCalls(content: string): ToolCallEntry[] {
  const cutoff = content.indexOf('<tool_result>');
  const text = cutoff !== -1 ? content.slice(0, cutoff) : content;

  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const calls: ToolCallEntry[] = [];
  let i = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    try {
      const body = JSON.parse(match[1]) as { name?: string; arguments?: Record<string, unknown> };
      calls.push({
        id: `xml_call_${i}`,
        type: 'function',
        function: {
          name: body.name ?? '',
          arguments: JSON.stringify(body.arguments ?? {}),
        },
      });
      i++;
    } catch {
      // skip malformed blocks
    }
  }

  return calls;
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
  if (toolName === 'ask_user') {
    return `"${((args.question as string) ?? '').slice(0, 60)}"`;
  }
  if (toolName === 'finish_task') {
    return `"${((args.summary as string) ?? '').slice(0, 60)}"`;
  }
  return JSON.stringify(args).slice(0, 80);
}

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
  } catch {
    // ignore
  }
}
