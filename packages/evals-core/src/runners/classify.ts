/**
 * Shared classification utilities used by all agent runners.
 *
 * All runners produce a RunRecord consumed by the scorer and reporting
 * pipeline. Runner-agnostic classification helpers live here so no runner
 * needs to import from another.
 */

import type { ErrorCategory } from '../types/agents.js';
import type { ActionType, ToolCallRecord } from '../types/scorer.js';

// ── Action type classification ───────────────────────────────────────────────

const TOOL_ACTION_TYPES: Record<string, ActionType> = {
  ask_user: 'Interruption',
  fetch_url: 'Discovery',
  read_file: 'Discovery',
  list_files: 'Discovery',
  write_file: 'Implementation',
  // run_command is intentionally absent: it is classified by command intent in classifyActionType (see classifyCommandIntent)
  finish_task: 'Implementation',
  search_auth0_docs: 'Discovery',
  skill: 'Skill',
  plan: 'Discovery',
  todo_read: 'Discovery',
  todo_write: 'Discovery',
};

/**
 * Classify the type of action represented by a tool call based on its name,
 * its arguments, and whether it caused an error.
 *
 * `run_command` is classified by *command intent* (see `classifyCommandIntent`)
 * rather than by tool name, so shell-driven discovery / doc-reads / navigation do
 * not all collapse into `Implementation`. All other tools map by name.
 */
export function classifyActionType(name: string, args: Record<string, unknown>, causedError: boolean): ActionType {
  if (causedError) {
    return 'Error';
  }

  // MCP tools are prefixed mcp__<server>__<tool> by Claude Code — treat as Discovery
  if (name.startsWith('mcp__')) {
    return 'Discovery';
  }

  if (name === 'run_command') {
    return classifyCommandIntent(String(args.command ?? ''));
  }

  return TOOL_ACTION_TYPES[name] ?? 'unknown';
}

// ── Command intent classification (for run_command) ──────────────────────────

/** Leading verbs / shapes that read state or orient — never mutate. */
const READ_ONLY_LEADERS = [
  'ls',
  'cat',
  'grep',
  'head',
  'tail',
  'find',
  'pwd',
  'cd',
  'env',
  'which',
  'echo',
  'jq', // JSON filter — reads/reshapes stdin, never writes the workspace
  'set', // shell option toggle (`set -e`) — a no-op prefix, not a mutation
  'export', // sets an env var — orientation, not a workspace write
  'sed', // only when NOT in-place (`sed -i` is caught as a mutation below)
];

/** Leading verbs that mutate the local workspace (files, installs, git writes). */
const MUTATION_LEADERS = [
  'touch',
  'mkdir',
  'rm',
  'mv',
  'cp',
  'ln',
  'tee',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'pip',
  'pip3',
  'chmod',
  'chown',
];

/** Read-only git subcommands (everything else under `git` is treated as a mutation). */
const READ_ONLY_GIT_SUBCOMMANDS = ['status', 'log', 'diff', 'show', 'branch', 'remote'];

/** Read-only npm subcommands (everything else under `npm` — install/run/… — mutates). */
const READ_ONLY_NPM_SUBCOMMANDS = ['ls', 'list', 'view', 'outdated', 'why', 'search'];

type SegmentIntent = 'tenant-write' | 'mutation' | 'discovery' | 'ambiguous';

/**
 * Tokenise a shell segment on whitespace, dropping empty tokens. Quotes are not
 * interpreted — we only ever inspect the leading verb and (for `auth0 api`) the
 * verb position, so quoted arguments never influence the classification.
 */
function tokens(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean);
}

/**
 * Drop leading command wrappers (`env`, `sudo`, `command`, `nohup`, `time`,
 * `xargs`) and inline `KEY=VALUE` environment assignments so the *real* leading
 * verb is selected. Without this, `env DOMAIN=x auth0 api put …` would classify
 * on `env` (Discovery) and `sudo auth0 apps create` on `sudo` (ambiguous →
 * Implementation), masking the tenant write underneath.
 */
const COMMAND_WRAPPERS = new Set(['env', 'sudo', 'command', 'nohup', 'time', 'xargs']);
function stripWrappers(parts: string[]): string[] {
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part === undefined || !(COMMAND_WRAPPERS.has(part) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(part))) {
      break;
    }
    i++;
  }
  return parts.slice(i);
}

/**
 * True when a segment redirects to a real file (a workspace write). Ignores
 * redirects that don't touch the workspace: file-descriptor duplication
 * (`2>&1`, `>&2`) and device sinks (`/dev/null`, `/dev/stderr`, `/dev/tty`,
 * `/dev/fd/N`, …). Quoted spans are stripped first so a literal `>` inside an
 * argument (e.g. `grep ">" file`) never counts as a redirect.
 */
function hasFileRedirect(segment: string): boolean {
  const unquoted = segment.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');
  const stripped = unquoted.replace(/\d*>&\d*/g, ' ').replace(/\d*>>?\s*\/dev\/\S+/g, ' ');
  return />>?/.test(stripped);
}

/** Classify a single (already-split) command segment. */
function classifySegment(segment: string): SegmentIntent {
  const trimmed = segment.trim();
  if (!trimmed) {
    return 'discovery';
  }

  // A redirect to a real file writes the workspace regardless of the leading
  // verb. fd-redirects (`2>&1`) and the discard sink (`2>/dev/null`) do not.
  if (hasFileRedirect(trimmed)) {
    return 'mutation';
  }

  // Strip wrappers/env-assignments so `env FOO=x auth0 api put …` and
  // `sudo auth0 apps create` classify on the real verb, not the wrapper. A bare
  // wrapper with nothing after it (e.g. `env` alone prints the environment) is
  // orientation → Discovery.
  const parts = stripWrappers(tokens(trimmed));
  if (parts.length === 0) {
    return 'discovery';
  }
  const leader = parts[0];

  if (leader === 'auth0') {
    // auth0 api <verb> …  — reads are Discovery, writes are TenantConfig.
    // Match on the verb position (token after `api`) so a quoted path such as
    // `auth0 api get "clients/create-x"` classifies on `get`, not on `create`.
    if (parts[1] === 'api') {
      const verb = (parts[2] ?? '').toLowerCase();
      if (['put', 'post', 'patch', 'delete'].includes(verb)) {
        return 'tenant-write';
      }
      if (['get', 'list', 'show'].includes(verb)) {
        return 'discovery';
      }
      // Unknown api verb — treat conservatively as a mutation.
      return 'mutation';
    }

    // auth0 <resource> <action> … — resource-command reads (`auth0 apps list`,
    // `auth0 tenants list`, `... show`) are Discovery; writes (create/update/
    // delete/use) reconfigure the tenant → TenantConfig.
    const action = (parts[2] ?? parts[1] ?? '').toLowerCase();
    if (['list', 'show', 'open', 'get'].includes(action)) {
      return 'discovery';
    }
    if (['create', 'update', 'delete', 'use', 'rotate', 'enable', 'disable'].includes(action)) {
      return 'tenant-write';
    }
    // Orientation probes (`auth0 --version`) fall through to the --help/--version
    // guard below; any other auth0 command is treated conservatively as mutation.
    if (!parts.some((t) => t === '--version' || t === '--help')) {
      return 'mutation';
    }
  }

  // `sed -i` edits in place; any other `sed` invocation is a read.
  if (leader === 'sed') {
    return parts.some((t) => t === '-i' || t.startsWith('-i')) ? 'mutation' : 'discovery';
  }

  // `git` — read-only subcommands are Discovery; writes (add/commit/push/…) mutate.
  if (leader === 'git') {
    const sub = (parts[1] ?? '').toLowerCase();
    return READ_ONLY_GIT_SUBCOMMANDS.includes(sub) ? 'discovery' : 'mutation';
  }

  // `npm` — read-only subcommands (ls/view/outdated/…) are Discovery; install/run/… mutate.
  if (leader === 'npm') {
    const sub = (parts[1] ?? '').toLowerCase();
    return READ_ONLY_NPM_SUBCOMMANDS.includes(sub) ? 'discovery' : 'mutation';
  }

  // A bare `--version` / `--help` probe (e.g. `auth0 --version`) is orientation.
  if (parts.some((t) => t === '--version' || t === '--help')) {
    return 'discovery';
  }

  if (leader && MUTATION_LEADERS.includes(leader)) {
    return 'mutation';
  }

  if (leader && READ_ONLY_LEADERS.includes(leader)) {
    return 'discovery';
  }

  return 'ambiguous';
}

/**
 * Split a shell command into segments on the operators that separate commands
 * (`&&`, `||`, `;`, `|`) and on newlines, **ignoring any operator that falls
 * inside single or double quotes**. A naive `String.split` mis-splits real
 * commands: `grep "a\|b" f` (alternation inside quotes), `sed -n '1,5p;9p'`
 * (`;` inside a range), and multi-line heredoc/`&&` blocks would each be torn
 * into meaningless fragments and misclassified.
 */
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }

    // Two-char operators: && and ||
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      segments.push(current);
      current = '';
      i++; // consume the second operator char
      continue;
    }

    // Single-char separators: ; | and newline
    if (ch === ';' || ch === '|' || ch === '\n') {
      segments.push(current);
      current = '';
      continue;
    }

    current += ch;
  }
  segments.push(current);

  return segments.filter((s) => s.trim().length > 0);
}

/**
 * Classify a shell command by intent. Chained commands are split on `&&`, `||`,
 * `;`, `|`, and newlines (quote-aware — separators inside quotes are ignored),
 * then combined by precedence: any tenant write wins, then any mutation,
 * otherwise Discovery. Unrecognised commands fall back to `Implementation` so we
 * never over-claim Discovery.
 */
export function classifyCommandIntent(command: string): ActionType {
  const segments = splitSegments(command);
  if (segments.length === 0) {
    return 'Implementation';
  }

  const intents = segments.map(classifySegment);

  if (intents.includes('tenant-write')) {
    return 'TenantConfig';
  }
  if (intents.includes('mutation') || intents.includes('ambiguous')) {
    return 'Implementation';
  }
  return 'Discovery';
}

// ── Primary argument extraction (for retry detection) ────────────────────────

/**
 * Extract the primary identifying argument from a tool call's name and
 * arguments, used for retry detection.
 */
export function primaryArg(name: string, args: Record<string, unknown>): string {
  if (name === 'read_file' || name === 'list_files' || name === 'write_file') {
    return (args.path ?? args.filename ?? args.file_path ?? '') as string;
  }
  if (name === 'run_command') {
    return ((args.command as string) ?? '').slice(0, 80);
  }
  if (name === 'fetch_url') {
    return (args.url as string) ?? '';
  }
  if (name === 'ask_user') {
    return ((args.question as string) ?? '').slice(0, 80);
  }
  return JSON.stringify(args).slice(0, 80);
}

// ── Retry detection ──────────────────────────────────────────────────────────

/**
 * Detect if the current tool call is a retry of a previous call that caused
 * an error.
 */
export function detectRetry(toolCalls: ToolCallRecord[], toolName: string, toolArgs: Record<string, unknown>): boolean {
  const thisPrimary = primaryArg(toolName, toolArgs);
  const lastSame = toolCalls.findLast(
    (prev) => prev.name === toolName && primaryArg(prev.name, prev.args) === thisPrimary,
  );
  return lastSame?.causedError === true;
}

// ── Error classification ─────────────────────────────────────────────────────

/**
 * Classify an error result string into a category.
 */
export function classifyErrorCategory(result: string): ErrorCategory {
  const r = result.toLowerCase();
  if (['not found', 'no such file', 'does not exist', 'file not found'].some((p) => r.includes(p))) return 'not_found';
  if (['timed out', 'timeout', 'deadline'].some((p) => r.includes(p))) return 'timeout';
  if (['permission denied', 'access denied', 'forbidden', '403'].some((p) => r.includes(p))) return 'permission';
  if (['401', 'unauthorized', 'unauthenticated'].some((p) => r.includes(p))) return 'auth';
  if (['connection', 'network', 'could not fetch', 'urlopen error', 'name or service'].some((p) => r.includes(p)))
    return 'network';
  if (['syntaxerror', 'syntax error', 'unexpected token', 'json', 'parse error', 'decode'].some((p) => r.includes(p)))
    return 'syntax';
  return 'unknown';
}
