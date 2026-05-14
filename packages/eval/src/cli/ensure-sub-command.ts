const SUB_COMMANDS = new Set(['run', 'report']);
const HELP_FLAGS = new Set(['--help', '-h']);

/**
 * Inserts the default 'run' sub-command when no known sub-command is present.
 * This keeps backwards compatibility: `a0-eval --eval foo` still works.
 *
 * Only inspects argv[2] (the first arg after node+script) to avoid mis-routing
 * when an option value happens to equal a sub-command name (e.g. `--eval report`).
 * Help flags are left untouched so top-level `a0-eval --help` works.
 */
export function ensureSubCommand(argv: string[]): string[] {
  const first = argv[2];
  if (!first || HELP_FLAGS.has(first)) return argv;
  if (SUB_COMMANDS.has(first)) return argv;
  return [...argv.slice(0, 2), 'run', ...argv.slice(2)];
}
