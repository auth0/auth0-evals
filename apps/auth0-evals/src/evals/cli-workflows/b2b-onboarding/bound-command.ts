import { GraderLevel } from '@a0/evals-graders';
import type { EventToolCall, GraderDef } from '@a0/evals-graders';

/**
 * A route check for one typed CLI command. It looks at each simple command on its own, so a value
 * that belongs to another command in the same shell call does not count, and it ignores `--help`
 * probes. A value has to be a whole argument, not the tail of a longer one (`not-acme`).
 */

// Tool names that run a shell command (Claude: run_command, Gemini: bash).
const RUN_COMMAND_NAMES = new Set(['run_command', 'bash']);
const HELP = /(?:^|\s)(?:--help|-h)(?=\s|$)/;

/**
 * Splits a shell call into simple commands at `&&`, `||`, `;`, `|` and newlines. It does not split
 * inside quotes, `$(...)` or backticks, and a backslash-newline continues the same command.
 */
export function splitCommands(call: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | undefined;
  let depth = 0;
  let backtick = false;
  for (let i = 0; i < call.length; i++) {
    const ch = call[i] as string;
    const next = call[i + 1];
    if (ch === '\\' && quote !== "'") {
      if (next === '\n' || (next === '\r' && call[i + 2] === '\n')) {
        current += ' ';
        i += next === '\r' ? 2 : 1;
      } else {
        current += ch + (next ?? '');
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '`') {
      backtick = !backtick;
    } else if (ch === '$' && next === '(') {
      depth++;
      current += '$(';
      i++;
      continue;
    } else if (ch === ')' && depth > 0) {
      depth--;
    } else if (depth === 0 && !backtick && (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && next === '&'))) {
      parts.push(current);
      current = '';
      if ((ch === '|' && next === '|') || ch === '&') i++;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

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
        .flatMap(splitCommands)
        .some(
          (segment) =>
            commands.some((c) => segment.includes(c)) &&
            !HELP.test(segment.replace(/'[^']*'|"[^"]*"/g, '')) &&
            bindings.every((b) => b(segment)),
        ),
  };
}

// The CLI's own rejection of a command or flag it does not have.
const UNKNOWN_INPUT =
  /(?:^|\n)\s*(?:Error:\s*)?unknown (?:command|flag|shorthand flag)\b|"message"\s*:\s*"unknown (?:command|flag|shorthand flag)\b|"reason"\s*:\s*"flag_parse"/;

/**
 * Passes when the CLI never rejected a command or flag the agent typed. It reads the output, so a
 * failed call counts here, unlike the command checks that skip calls that errored.
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
