/**
 * Grader factory functions.
 *
 * Each function creates a GraderDef descriptor. The actual evaluation
 * logic lives in runner.ts (runGraders).
 */

import type { GraderLevel, GraderDef, GraderOptions, EventToolCall } from './types.js';

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

function getRunCommands(toolCalls: EventToolCall[]): string[] {
  return toolCalls
    .filter((tc) => tc.name === 'run_command' && !tc.causedError)
    .map((tc) => (tc.args.command as string) ?? '');
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
  args?: string | string[],
  description?: string,
  level?: GraderLevel,
): GraderDef {
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
export function ranCommandOneOf(commands: string[], description?: string, level?: GraderLevel): GraderDef {
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
 * Asserts that the agent wrote a file whose path contains the given substring.
 */
export function wroteFile(path: string, description?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'event',
    name: description ?? `wrote file matching '${path}'`,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      toolCalls
        .filter((tc) => tc.name === 'write_file' && !tc.causedError)
        .some((tc) => String(tc.args.path ?? tc.args.filename ?? tc.args.file_path ?? '').includes(path)),
  };
}
