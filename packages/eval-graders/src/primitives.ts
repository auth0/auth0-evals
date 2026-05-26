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

export function judge(question: string, framework?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'judge',
    question,
    framework,
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
export function ranCommandOneOf(commands: string[], description: string | undefined, level: EventGraderLevel): GraderDef {
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

/**
 * Asserts that the agent wrote a file whose path contains the given substring.
 */
export function wroteFile(path: string, description: string | undefined, level: EventGraderLevel): GraderDef {
  validateEventLevel(level, 'wroteFile');
  return {
    kind: 'event',
    name: description ?? `wrote file matching '${path}'`,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      toolCalls
        .filter((tc) => WRITE_TOOL_NAMES.has(tc.name) && !tc.causedError)
        .some((tc) => String(tc.args.path ?? tc.args.filename ?? tc.args.file_path ?? '').includes(path)),
  };
}
