export const BASE_URL = 'https://llm.atko.ai/v1';

export const JUDGE_MODEL = 'claude-4-5-sonnet';

export const JUDGE_MAX_TOKENS = 1024;

/** Maximum characters of combined source code sent to the LLM judge. */
export const JUDGE_MAX_CODE_CHARS = 16384;

export const MAX_TURNS = 30;

// Model name prefixes routed through Bedrock — require special handling
// (XML tool calls, no tool_choice, results as user messages).
export const BEDROCK_MODELS = ['claude-'];

// Claude models that support output_config.effort to cap reasoning effort and reduce latency.
// Supported here: Claude Opus 4.6, Sonnet 4.6, Opus 4.7, and Opus 4.5.
export const CLAUDE_EFFORT_MODELS = new Set(['claude-4-6-opus', 'claude-4-6-sonnet', 'claude-opus-4-7', 'claude-4-5-opus']);

// Model name prefixes that use the older functions/function_call API
// instead of tools/tool_choice.
export const GEMINI_MODELS = ['gemini-'];

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
