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
  };
}

export function matches(pattern: string, description?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'matches',
    pattern,
    name: description ?? `matches /${pattern}/`,
    level,
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

export function judge(question: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'judge',
    question,
    name: question,
    level,
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
