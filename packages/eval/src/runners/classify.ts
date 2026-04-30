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
  run_command: 'Implementation',
  finish_task: 'Implementation',
  search_auth0_docs: 'Discovery',
  skill: 'Skill',
};

/**
 * Classify the type of action represented by a tool call based on its name
 * and whether it caused an error.
 */
export function classifyActionType(name: string, causedError: boolean): ActionType {
  if (causedError) {
    return 'Error';
  }

  // MCP tools are prefixed mcp__<server>__<tool> by Claude Code — treat as Discovery
  if (name.startsWith('mcp__')) {
    return 'Discovery';
  }

  return TOOL_ACTION_TYPES[name] ?? 'unknown';
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
