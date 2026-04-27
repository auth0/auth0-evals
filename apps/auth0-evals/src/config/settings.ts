export const BASE_URL = '<LLM_PROXY_URL>/v1';

export const JUDGE_MODEL = 'claude-sonnet-4-5';

export const JUDGE_MAX_TOKENS = 1024;

/** Maximum characters of combined source code sent to the LLM judge. */
export const JUDGE_MAX_CODE_CHARS = 16384;

export const MAX_TURNS = 30;

// Model name prefixes routed through Bedrock — require special handling
// (XML tool calls, no tool_choice, results as user messages).
export const BEDROCK_MODELS = ['claude-'];

// Claude models that support output_config.effort to cap reasoning effort and reduce latency.
// Supported here: Claude Opus 4.6, Sonnet 4.6, Opus 4.7, and Opus 4.5.
export const CLAUDE_EFFORT_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-opus-4-5',
]);

// Model name prefixes that use the older functions/function_call API
// instead of tools/tool_choice.
export const GEMINI_MODELS = ['gemini-'];

/**
 * Maps the friendly ATKO model aliases to the LiteLLM proxy model IDs.
 * LiteLLM requires an underscore prefix to route to the correct deployment
 * (e.g. `_claude-opus-4-7` instead of `claude-opus-4-7`).
 *
 * IMPORTANT: These prefixed names must ONLY be used when sending requests to the LiteLLM proxy.
 * Reports, score files, and RunRecords must always use the friendly alias (without underscore).
 */
export const LITELLM_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-6': '_claude-sonnet-4-6',
  'claude-opus-4-6': '_claude-opus-4-6',
  'claude-opus-4-7': '_claude-opus-4-7',
  'claude-sonnet-4-5': '_claude-sonnet-4-5',
  'claude-opus-4-5': '_claude-opus-4-5',
};

/** Reverse lookup: LiteLLM model ID → friendly ATKO alias. */
export const LITELLM_MODEL_REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(LITELLM_MODEL_MAP).map(([alias, litellm]) => [litellm, alias]),
);

export const MAX_LISTED_FILES = 200;
export const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  '.build',
]);

/** Maximum wall-clock time for a single Claude Code subprocess task (~6.9 hours). */
export const CLAUDE_CODE_TASK_TIMEOUT_MS = 50 * 300_000;

/** Maximum wall-clock time for a single Copilot SDK agent task (~6.9 hours). */
export const COPILOT_TASK_TIMEOUT_MS = 50 * 300_000;
