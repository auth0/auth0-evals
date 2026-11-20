import { GraderLevel } from '@a0/evals-graders';
import type { EventToolCall, GraderDef } from '@a0/evals-graders';

/**
 * A route check for one typed CLI command. It looks at each simple command on its own, so a value
 * that belongs to another command in the same shell call does not count, and it ignores `--help`
 * probes. A value has to be a whole argument, not the tail of a longer one (`not-acme`).
 */

// Tool names that run a shell command (Claude: run_command, Gemini: bash).
const RUN_COMMAND_NAMES = new Set(['run_command', 'bash']);
// Splits a shell call into simple commands.
const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\||\n)\s*/;
const HELP = /(?:^|\s)(?:--help|-h)(?=\s|$)/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A test that one simple command carries a required value. */
export type Binding = (segment: string) => boolean;

/**
 * The value is the whole argument of one of the flags (`--name acme`, `--name=acme`, `-n "acme"`),
 * or the whole string value of `jsonKey` in an inline `--data` JSON payload.
 */
export function flagValue(flags: string[], value: string, jsonKey?: string): Binding {
  const flagRe = new RegExp(`(?:^|\\s)(?:${flags.map(escape).join('|')})(?:=|\\s+)(['"]?)${escape(value)}\\1(?=\\s|$)`);
  const jsonRe = jsonKey
    ? new RegExp(`\\\\?"${escape(jsonKey)}\\\\?"\\s*:\\s*\\\\?"${escape(value)}\\\\?"`)
    : undefined;
  return (segment) => flagRe.test(segment) || (jsonRe?.test(segment) ?? false);
}

/** The value is a whole positional argument that directly follows `after` (a regex source). */
export function positionalValue(after: string, value: string): Binding {
  const re = new RegExp(`${after}\\s+(['"]?)${escape(value)}\\1(?=\\s|$)`);
  return (segment) => re.test(segment);
}

function runCommands(toolCalls: EventToolCall[]): string[] {
  return toolCalls
    .filter((tc) => RUN_COMMAND_NAMES.has(tc.name) && !tc.causedError)
    .map((tc) => String(tc.args.command ?? ''));
}

export function boundCommand(
  commands: string[],
  bindings: Binding[],
  description: string,
  level: GraderLevel.L4 | GraderLevel.L5,
): GraderDef {
  return {
    kind: 'event',
    name: description,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      runCommands(toolCalls)
        .flatMap((cmd) => cmd.replace(/\\\r?\n/g, ' ').split(SEGMENT_SPLIT))
        .some(
          (segment) =>
            commands.some((c) => segment.includes(c)) && !HELP.test(segment) && bindings.every((b) => b(segment)),
        ),
  };
}

const UNKNOWN_INPUT = /unknown (?:command|flag|shorthand flag)/i;

/**
 * Fails when the CLI rejected a command or flag the agent used. Reads each call's output, so a call
 * that failed counts here, unlike the checks above that only look at calls that succeeded.
 */
export function noInventedCliInput(description: string): GraderDef {
  return {
    kind: 'event',
    name: description,
    level: GraderLevel.L2,
    predicate: (toolCalls: EventToolCall[]) =>
      !toolCalls.filter((tc) => RUN_COMMAND_NAMES.has(tc.name)).some((tc) => UNKNOWN_INPUT.test(tc.result)),
  };
}
