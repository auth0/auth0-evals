/**
 * Utility helpers for the ReAct agent loop.
 *
 * Extracted from react-agent.ts to keep the core loop focused on orchestration.
 * All helpers are pure or filesystem-only (no LLM API calls).
 */

// ── Tool call entry ──────────────────────────────────────────────────────────

export interface ToolCallEntry {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

// ── Token extraction ─────────────────────────────────────────────────────────

export function extractTokens(usage: Record<string, number>): [number, number] {
  let inputTokens = usage.prompt_tokens;
  if (inputTokens === undefined) inputTokens = usage.input_tokens ?? 0;
  let outputTokens = usage.completion_tokens;
  if (outputTokens === undefined) outputTokens = usage.output_tokens ?? 0;
  return [inputTokens, outputTokens];
}

// ── Tool argument normalization ──────────────────────────────────────────────

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

// ── XML tool call parsing ────────────────────────────────────────────────────

/**
 * Parses XML tool calls from Bedrock model responses.
 *
 * Two XML dialects are in use depending on the proxy/model configuration:
 *
 * Format 1 — JSON body wrapped in <tool_call>:
 *   <tool_call>{"name":"read_file","input":{"path":"foo.ts"}}</tool_call>
 *
 * Format 2 — Anthropic <invoke> / <parameter> tags (used by claude-sonnet-4-6 via litellm):
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

// ── Argument summarization ───────────────────────────────────────────────────

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
