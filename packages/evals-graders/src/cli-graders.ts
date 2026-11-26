/**
 * Graders that read the shell commands an agent ran as parsed commands, not as text.
 *
 * `ranCommand` and friends match substrings of the whole shell call, so a help probe next to a real
 * request, an argument that merely mentions a command, or a value that is only the tail of a longer one
 * all pass. These graders parse each call into simple commands (see `shell.ts`) and check the
 * executable, the subcommand and the arguments of one command at a time.
 *
 * Use them when a workflow eval must tell the typed CLI command from a raw API call, or must be sure that
 * a value belongs to the right flag.
 */

import type { EventGraderLevel, EventToolCall, GraderDef, NotRanCommandLevel } from './types.js';
import { GraderLevel } from './types.js';
import { RUN_COMMAND_NAMES, getWriteContent, getWritePath, validateEventLevel } from './primitives.js';
import { parseShell } from './shell.js';
import type { ShellCommand } from './shell.js';

/**
 * A test that one command carries a required argument. It receives the words after the executable and
 * subcommand. Build one with `flagArg` or `positionalArg`.
 */
export type CliBinding = (args: string[]) => boolean;

// Whole-file writes only: an edit carries a fragment, not the file.
const WRITE_TOOLS = new Set(['write_file', 'write']);

const HELP_FLAGS = new Set(['--help', '-h']);

/** True when the command asks for help instead of doing the work. */
function isHelp(command: ShellCommand): boolean {
  return command.words.some((w) => HELP_FLAGS.has(w));
}

/**
 * Every command of every shell call, in order. These graders answer "which command did the agent
 * use", not "did it work", so a chain whose last step failed still counts for the earlier steps and a
 * tenant-state grader decides whether the work was done. Calls are expanded with the files the agent
 * wrote, so a `--data @body.json` payload can be read.
 *
 * With `creditOnly`, the last command of a call that failed is left out: its exit status is the call's,
 * so it is the command most likely to have failed. Use it when a command should earn credit, not when a
 * command is forbidden.
 */
function parsedCommands(toolCalls: EventToolCall[], creditOnly = false): ShellCommand[] {
  // Files as they stood when each command ran: the latest write before it wins, and a file written
  // after a command was used does not count for that command.
  const files = new Map<string, string>();
  const out: ShellCommand[] = [];
  for (const tc of toolCalls) {
    if (RUN_COMMAND_NAMES.has(tc.name)) {
      const commands = parseShell(String(tc.args.command ?? ''));
      for (const command of commands) {
        out.push(expandFileRefs(command, files));
        for (const w of command.writes) files.set(w.path, w.content);
      }
      if (creditOnly && tc.causedError && commands.length > 0) out.pop();
    } else if (WRITE_TOOLS.has(tc.name) && !tc.causedError) {
      const path = getWritePath(tc);
      if (path) files.set(path, getWriteContent(tc));
    }
  }
  return out;
}

/** Finds a written file by the path the command used, tolerating a relative path against an absolute write. */
function lookup(files: Map<string, string>, path: string): string | undefined {
  return files.get(path) ?? [...files.entries()].find(([k]) => k.endsWith(`/${path.replace(/^\.\//, '')}`))?.[1];
}

/** Replaces `@path` and `--flag=@path` arguments with the content the agent wrote to that path. */
function expandFileRefs(command: ShellCommand, files: Map<string, string>): ShellCommand {
  if (files.size === 0) return command;
  const words = command.words.map((w) => {
    const eq = w.indexOf('=@');
    if (w.startsWith('@')) return lookup(files, w.slice(1)) ?? w;
    if (w.startsWith('-') && eq !== -1) {
      const content = lookup(files, w.slice(eq + 2));
      return content === undefined ? w : `${w.slice(0, eq + 1)}${content}`;
    }
    return w;
  });
  return { ...command, words };
}

/** The command words, as `['auth0', 'apps', 'create']` for `'auth0 apps create'`. */
const commandWords = (command: string): string[] => command.trim().split(/\s+/).filter(Boolean);

/** The words after `spec` (executable and subcommand, such as `auth0 apps create`) when the command starts with them, else undefined. */
function argsAfter(command: ShellCommand, spec: string[]): string[] | undefined {
  const { words } = command;
  let at = 0;
  for (const [k, s] of spec.entries()) {
    if (k > 0) at = skipGlobalFlags(words, at);
    if (words[at] !== s) return undefined;
    at++;
  }
  return words.slice(at);
}

// Persistent flags of the auth0 CLI, and how many values each takes. They may sit before or between
// the subcommand words (`auth0 --tenant t apps create`).
const GLOBAL_FLAGS = new Map([
  ['--debug', 0],
  ['--no-color', 0],
  ['--no-input', 0],
  ['--tenant', 1],
]);

function skipGlobalFlags(words: string[], from: number): number {
  let at = from;
  for (;;) {
    const w = words[at];
    if (w === undefined) return at;
    const values = GLOBAL_FLAGS.get(w);
    if (values !== undefined) at += 1 + values;
    else if ([...GLOBAL_FLAGS.keys()].some((f) => w.startsWith(`${f}=`))) at++;
    else return at;
  }
}

/** The arguments of the first spec the command runs, or undefined. */
function matchArgs(command: ShellCommand, specs: string[][]): string[] | undefined {
  for (const spec of specs) {
    const args = argsAfter(command, spec);
    if (args) return args;
  }
  return undefined;
}

function tryJson(text: string): unknown {
  if (!/^\s*[{[]/.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The value is the whole argument of one of the flags: `--name acme`, `--name=acme`, `-n 'acme'`.
 * A value that only ends an argument (`not-acme`) does not count.
 *
 * With `jsonKey`, the value may instead be the whole string value of that top-level key in a JSON
 * argument, such as an inline `--data '{"name":"acme"}'` or a `--data @body.json` file the agent wrote.
 */
export function flagArg(flags: string | string[], value: string, jsonKey?: string): CliBinding {
  const names = Array.isArray(flags) ? flags : [flags];
  return (words) => {
    for (let i = 0; i < words.length; i++) {
      const w = words[i] as string;
      if (names.some((n) => w === n) && words[i + 1] === value) return true;
      if (names.some((n) => w === `${n}=${value}`)) return true;
      if (jsonKey !== undefined) {
        // A payload may be a separate argument or the value of `--data=...`.
        const parsed = tryJson(w.startsWith('-') && w.includes('=') ? w.slice(w.indexOf('=') + 1) : w);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if ((parsed as Record<string, unknown>)[jsonKey] === value) return true;
        }
      }
    }
    return false;
  };
}

/**
 * The value is a whole positional argument: the one at `index` among the arguments after the subcommand that do not
 * start with `-`. List flags that take a value in `valueFlags` so their values are not counted as positional.
 *
 *     positionalArg('login-id', { valueFlags: ['-l', '--language'] })   // auth0 universal-login prompts update -l en login-id
 */
export function positionalArg(value: string, options: { index?: number; valueFlags?: string[] } = {}): CliBinding {
  const { index = 0, valueFlags = [] } = options;
  return (words) => {
    const positional: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i] as string;
      if (valueFlags.includes(w)) i++;
      else if (!w.startsWith('-')) positional.push(w);
    }
    return positional[index] === value;
  };
}

function commandList(command: string | string[]): string[][] {
  return (Array.isArray(command) ? command : [command]).map(commandWords);
}

/**
 * Asserts that the agent ran one CLI command, with every binding true for that same command.
 *
 * The call is split into simple commands, and the executable and subcommand are matched as the first words (the
 * auth0 CLI's global flags, such as `--tenant t`, may sit before or between them), so
 * `printf 'apps create'` is not `auth0 apps create`. A command that asks for `--help` or `-h` is ignored. Commands
 * run through `bash -c`, `eval`, `$(...)`, backticks, `xargs`, `timeout`, `npx` or a piped shell count. Every command of a call that failed counts except its last one, which is the command that set the exit status.
 * A payload sent as `--data @file` is read when the agent wrote the file in the same run; a payload on stdin
 * or built by a script the agent runs is not visible.
 *
 *     ranCliCommand('auth0 apps create', [flagArg(['--name', '-n'], 'Portal', 'name')], 'Created the app', GraderLevel.L5)
 *
 * @param command - Executable and subcommand words; an array accepts any one of several alternatives
 * @param bindings - Argument checks, all of which must pass on one command
 * @param description - Grader name
 * @param level - Grader level (L4 or L5)
 */
export function ranCliCommand(
  command: string | string[],
  bindings: CliBinding[],
  description: string | undefined,
  level: EventGraderLevel,
): GraderDef {
  validateEventLevel(level, 'ranCliCommand');
  const specs = commandList(command);
  return {
    kind: 'event',
    name: description ?? `ran CLI command '${specs.map((s) => s.join(' ')).join(' | ')}'`,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      parsedCommands(toolCalls, true).some((cmd) => {
        const args = isHelp(cmd) ? undefined : matchArgs(cmd, specs);
        return args !== undefined && bindings.every((b) => b(args));
      }),
  };
}

/**
 * Asserts that the agent ran no CLI command with the given executable and subcommand. Unlike
 * `notRanCommand`, which looks for text, this parses the call: `auth0 apps delete --help`, a `grep` for the
 * words, or an `echo` of them is not a deletion. A call that failed still counts, because the
 * attempt is what this grader forbids.
 */
export function notRanCliCommand(
  command: string | string[],
  description: string | undefined,
  level: NotRanCommandLevel,
): GraderDef {
  const specs = commandList(command);
  return {
    kind: 'event',
    name: description ?? `did not run CLI command '${specs.map((s) => s.join(' ')).join(' | ')}'`,
    level,
    predicate: (toolCalls: EventToolCall[]) =>
      !parsedCommands(toolCalls).some((cmd) => !isHelp(cmd) && matchArgs(cmd, specs) !== undefined),
  };
}

// What a cobra-based CLI prints for input it does not have, as plain text or as a JSON error.
const REJECTED_INPUT =
  /(?:^|\n)\s*(?:Error:\s*)?unknown (?:command|flag|shorthand flag)\b|"message"\s*:\s*"unknown (?:command|flag|shorthand flag)\b|"reason"\s*:\s*"flag_parse"/;

/**
 * L2: fails when the CLI rejected a command or flag the agent used. It reads every shell call's
 * output, failed calls included. Only the CLI's own diagnostics match, so tenant data such as an
 * application named "Unknown Command" does not.
 */
export function noInventedCliInput(description?: string): GraderDef {
  return {
    kind: 'event',
    name: description ?? 'the CLI accepted every command and flag the agent used',
    level: GraderLevel.L2,
    predicate: (toolCalls: EventToolCall[]) =>
      !toolCalls.filter((tc) => RUN_COMMAND_NAMES.has(tc.name)).some((tc) => REJECTED_INPUT.test(tc.result)),
  };
}
