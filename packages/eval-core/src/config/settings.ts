import { getFrameworkConfig } from './framework-config.js';

export const MAX_TURNS = 75;

// Model name prefixes routed through Bedrock — require special handling
// (XML tool calls, no tool_choice, results as user messages).
export const BEDROCK_MODELS = ['claude-'];

// Claude models that support output_config.effort to cap reasoning effort and reduce latency.
// Supported here: Claude Opus 4.6, Sonnet 4.6, Opus 4.7, Opus 4.8, and Opus 4.5.
export const CLAUDE_EFFORT_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-4-5',
]);

// Model name prefixes that use the older functions/function_call API
// instead of tools/tool_choice.
export const GEMINI_MODELS = ['gemini-'];

// Model name prefixes for GPT models routed through the Codex runner.
export const GPT_MODELS = ['gpt-'];

/**
 * Maps friendly model aliases to the LiteLLM proxy model IDs.
 *
 * Reports, score files, and RunRecords must always use the friendly alias.
 */
export function getLitellmModelMap(): Record<string, string> {
  return getFrameworkConfig().models.litellm ?? {};
}

/** Reverse lookup: LiteLLM model ID → friendly model alias. */
export function getLitellmModelReverseMap(): Record<string, string> {
  return Object.fromEntries(Object.entries(getLitellmModelMap()).map(([alias, litellm]) => [litellm, alias]));
}

/** Maximum wall-clock time for a single Claude Code subprocess task (30 minutes).
 * This fires first as a graceful abort. The host-side 35-min Docker deadline
 * is a hard-kill backstop for unresponsive containers. */
export const CLAUDE_CODE_TASK_TIMEOUT_MS = 30 * 60_000;

/** Maximum wall-clock time for a single Copilot SDK agent task (30 minutes).
 * This fires first as a graceful abort. The host-side 35-min Docker deadline
 * is a hard-kill backstop for unresponsive containers. */
export const COPILOT_TASK_TIMEOUT_MS = 30 * 60_000;

/** Maximum wall-clock time for a single Codex CLI task (30 minutes).
 * This fires first as a graceful abort. The host-side 35-min Docker deadline
 * is a hard-kill backstop for unresponsive containers. */
export const CODEX_TASK_TIMEOUT_MS = 30 * 60_000;

/** Maximum wall-clock time for a single baseline LLM call (2 minutes). */
export const BASELINE_TASK_TIMEOUT_MS = 2 * 60_000;
