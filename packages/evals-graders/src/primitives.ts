/**
 * Grader factory functions.
 *
 * Each function creates a GraderDef descriptor. The actual evaluation
 * logic lives in runner.ts (runGraders).
 */

import type { GraderDef, GraderOptions, EventToolCall, EventGraderLevel } from './types.js';
import { GraderLevel } from './types.js';

export function contains(
  needle: string,
  description?: string,
  level?: GraderLevel,
  options: GraderOptions = {},
): GraderDef {
  return {
    kind: 'contains',
    needle,
    name: description ?? `contains '${needle}'`,
    level,
    caseSensitive: options.caseSensitive ?? true,
    source: options.source,
  };
}

export function notContains(
  needle: string,
  description?: string,
  level?: GraderLevel,
  options: GraderOptions = {},
): GraderDef {
  return {
    kind: 'not_contains',
    needle,
    name: description ?? `not_contains '${needle}'`,
    level,
    caseSensitive: options.caseSensitive ?? true,
    source: options.source,
  };
}

export function matches(
  pattern: string,
  description?: string,
  level?: GraderLevel,
  options: GraderOptions = {},
): GraderDef {
  return {
    kind: 'matches',
    pattern,
    name: description ?? `matches /${pattern}/`,
    level,
    // Default (undefined) keeps the regex case-insensitive; pass
    // caseSensitive: true to require an exact-case match.
    caseSensitive: options.caseSensitive,
    source: options.source,
  };
}

export function notContainsInSource(
  needle: string,
  description?: string,
  level?: GraderLevel,
  options: GraderOptions = {},
): GraderDef {
  return {
    kind: 'not_contains_in_source',
    needle,
    name: description ?? `not_contains_in_source '${needle}'`,
    level,
    caseSensitive: options.caseSensitive ?? true,
  };
}

/** Options for the `judge` primitive. */
export interface JudgeOptions {
  /**
   * Append the agent's successful command trace to the judge's input. Use for
   * evals whose artifact is CLI invocations rather than files (no files to
   * inspect). Defaults to false, so file-based judges are unaffected.
   */
  includeCommandTrace?: boolean;
  /**
   * Where to look for content to judge — see `GraderDef.source` for semantics.
   * Defaults to `'files'`. Use `'response'` or `'both'` for MCP-only evals
   * where the agent's answer is in its final reply, not written files.
   */
  source?: 'files' | 'response' | 'both';
}

export function judge(question: string, level?: GraderLevel, options: JudgeOptions = {}): GraderDef {
  return {
    kind: 'judge',
    question,
    name: question,
    level,
    includeCommandTrace: options.includeCommandTrace ?? false,
    source: options.source,
  };
}

// ── Event-based graders ─────────────────────────────────────────────────────

const VALID_EVENT_LEVELS = new Set<GraderLevel>([GraderLevel.L4, GraderLevel.L5]);

function validateEventLevel(level: EventGraderLevel | undefined, primitive: string): void {
  if (level !== undefined && !VALID_EVENT_LEVELS.has(level)) {
    throw new Error(
      `${primitive}: event-based graders only support L4 (structural) or L5 (version_correctness), got '${level}'`,
    );
  }
}

// Tool names that represent shell execution across runners (Claude: run_command, Gemini: bash).
const RUN_COMMAND_NAMES = new Set(['run_command', 'bash']);

function getRunCommands(toolCalls: EventToolCall[]): string[] {
  return toolCalls
    .filter((tc) => RUN_COMMAND_NAMES.has(tc.name) && !tc.causedError)
    .map((tc) => String(tc.args.command ?? ''));
}

/**
 * Asserts that the agent ran a shell command containing the given command substring,
 * and optionally containing all specified args.
 *
 * @param command - Substring that must appear in the executed command
 * @param args - Optional arg(s) that must also appear in the command string
 */
export function ranCommand(
  command: string,
  args: string | string[] | undefined,
  description: string | undefined,
  level: EventGraderLevel,
): GraderDef {
  validateEventLevel(level, 'ranCommand');
  const argList = args ? (Array.isArray(args) ? args : [args]) : [];
  const label = argList.length > 0 ? `${command} with [${argList.join(', ')}]` : command;
  return {
    kind: 'event',
    name: description ?? `ran command '${label}'`,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      getRunCommands(toolCalls).some((cmd) => cmd.includes(command) && argList.every((arg) => cmd.includes(arg))),
  };
}

/**
 * Asserts that the agent ran at least one command from a list of alternatives.
 * Each entry is matched as a substring against executed commands.
 */
export function ranCommandOneOf(
  commands: string[],
  description: string | undefined,
  level: EventGraderLevel,
): GraderDef {
  validateEventLevel(level, 'ranCommandOneOf');
  const label = commands.join(' | ');
  return {
    kind: 'event',
    name: description ?? `ran one of [${label}]`,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      getRunCommands(toolCalls).some((cmd) => commands.some((c) => cmd.includes(c))),
  };
}

/**
 * Asserts that the agent ran a sequence of commands **in order**.
 *
 * Each step is a needle (or a one-of array of alternative needles) that must be
 * found in the successful command trace, with every step matching *after* the
 * previous step's match ends. Ordering is checked across the concatenated trace,
 * so steps may be:
 *   - non-adjacent (unrelated commands between them), and
 *   - chained within a single shell command (`enable && enforce`) — agents
 *     commonly run an enable-then-enforce pair as one call.
 *
 * A single occurrence of a needle cannot satisfy two steps: step N+1 searches
 * only the text that starts after step N's match. Errored commands are ignored.
 *
 * This encodes causal dependencies that an unordered set of `ranCommand`s can't —
 * e.g. a factor must be enabled *before* a policy enforces it. Useful for
 * file-less CLI/tenant-config evals whose correctness lives entirely in the
 * command sequence.
 *
 * @param steps - Ordered needles; a nested array is a one-of alternative for that position
 */
export function ranCommandsInOrder(
  steps: Array<string | string[]>,
  description: string | undefined,
  level: EventGraderLevel,
): GraderDef {
  validateEventLevel(level, 'ranCommandsInOrder');
  const label = steps.map((step) => (Array.isArray(step) ? `(${step.join(' | ')})` : step)).join(' → ');
  return {
    kind: 'event',
    name: description ?? `ran commands in order [${label}]`,
    level,
    predicate: (toolCalls: EventToolCall[]) => {
      // Concatenate the successful command trace in order; a moving cursor
      // guarantees each step matches text after the previous step's match.
      const trace = getRunCommands(toolCalls).join('\n');
      let cursor = 0;
      for (const step of steps) {
        const alternatives = Array.isArray(step) ? step : [step];
        // Earliest match among this step's alternatives at/after the cursor.
        // On a tie (same index), prefer the shorter needle: it advances the
        // cursor the least, so it can never hide text a later step needs.
        let best = -1;
        let bestLen = 0;
        for (const needle of alternatives) {
          const idx = trace.indexOf(needle, cursor);
          if (idx !== -1 && (best === -1 || idx < best || (idx === best && needle.length < bestLen))) {
            best = idx;
            bestLen = needle.length;
          }
        }
        if (best === -1) return false;
        cursor = best + bestLen;
      }
      return true;
    },
  };
}

// Tool names that represent file writes across runners (Claude/Copilot: write_file, Gemini: write/edit).
const WRITE_TOOL_NAMES = new Set(['write_file', 'write', 'edit']);

// Runners normalize write-tool args to { path, content } before they reach graders.
function getWritePath(tc: EventToolCall): string {
  return String(tc.args.path ?? '');
}

function getWriteContent(tc: EventToolCall): string {
  return String(tc.args.content ?? '');
}

function getFileWrites(toolCalls: EventToolCall[]): EventToolCall[] {
  return toolCalls.filter((tc) => WRITE_TOOL_NAMES.has(tc.name) && !tc.causedError);
}

// Tool names from any runner that represent MCP tool invocations are prefixed `mcp__`.
const MCP_TOOL_PREFIX = 'mcp__';

/**
 * Successful (non-errored) MCP tool calls — names are `mcp__<server>__<tool>`.
 */
function getSuccessfulMcpCalls(toolCalls: EventToolCall[]): EventToolCall[] {
  return toolCalls.filter((tc) => tc.name.startsWith(MCP_TOOL_PREFIX) && !tc.causedError);
}

/**
 * Asserts that the agent wrote a file whose path contains the given substring.
 *
 * When `expected` is provided, additionally asserts that the combined content of
 * all writes to that path contains every `expected` substring. Combining content
 * across writes handles agents that build a file incrementally (e.g. appending env
 * vars one line at a time). Use the content form to verify env vars landed in a
 * .env file when the file itself is excluded from the judge's view.
 *
 * @param path - Substring that must appear in the written file's path
 * @param description - Human-readable grader name
 * @param level - Event grader level (L4 or L5)
 * @param expected - Optional substring(s) that must ALL appear in the combined written content
 */
export function wroteFile(
  path: string,
  description: string | undefined,
  level: EventGraderLevel,
  expected?: string | string[],
): GraderDef {
  validateEventLevel(level, 'wroteFile');
  const expectedList = expected === undefined ? [] : Array.isArray(expected) ? expected : [expected];
  const defaultName =
    expectedList.length > 0
      ? `wrote file matching '${path}' containing [${expectedList.join(', ')}]`
      : `wrote file matching '${path}'`;
  return {
    kind: 'event',
    name: description ?? defaultName,
    level,
    predicate: (toolCalls: EventToolCall[]) => {
      const writes = getFileWrites(toolCalls).filter((tc) => getWritePath(tc).includes(path));
      if (expectedList.length === 0) return writes.length > 0;
      const combined = writes.map(getWriteContent).join('\n');
      return combined.length > 0 && expectedList.every((needle) => combined.includes(needle));
    },
  };
}

/**
 * Asserts that the eval's compile_command succeeds when run against the workspace
 * after the agent finishes. The framework runs the command and captures the result;
 * this grader reads it. The command comes from the eval's `compile_command`
 * frontmatter, so no command argument is needed here.
 */
export function compiles(description: string | undefined, level: EventGraderLevel): GraderDef {
  validateEventLevel(level, 'compiles');
  return {
    kind: 'compile',
    name: description ?? 'compiles successfully',
    level,
  };
}

/**
 * Asserts that the agent invoked an MCP tool whose (lowercased) name contains
 * the given substring. MCP calls are recorded as `mcp__<server>__<tool>`.
 * Errored calls are excluded — a failed MCP call is not a successful invocation.
 */
export function calledTool(toolName: string, description: string | undefined, level: EventGraderLevel): GraderDef {
  validateEventLevel(level, 'calledTool');
  const lc = toolName.toLowerCase();
  return {
    kind: 'event',
    name: description ?? `called MCP tool '${toolName}'`,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      getSuccessfulMcpCalls(toolCalls).some((tc) => tc.name.toLowerCase().includes(lc)),
  };
}

/**
 * Asserts that the agent invoked at least one of the given MCP tools.
 * Each name is matched as a (lowercased) substring against `mcp__` tool calls.
 */
export function calledToolOneOf(
  toolNames: string[],
  description: string | undefined,
  level: EventGraderLevel,
): GraderDef {
  validateEventLevel(level, 'calledToolOneOf');
  const lcs = toolNames.map((t) => t.toLowerCase());
  return {
    kind: 'event',
    name: description ?? `called one of MCP tools [${toolNames.join(', ')}]`,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      getSuccessfulMcpCalls(toolCalls).some((tc) => lcs.some((lc) => tc.name.toLowerCase().includes(lc))),
  };
}
