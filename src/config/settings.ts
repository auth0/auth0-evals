export const BASE_URL = 'https://llm.atko.ai/v1';

export const JUDGE_MODEL = 'claude-4-5-sonnet';

export const JUDGE_MAX_TOKENS = 300;

export const MAX_TURNS = 30;

// Model name prefixes routed through Bedrock — require special handling
// (XML tool calls, no tool_choice, results as user messages).
export const BEDROCK_MODELS = ['claude-'];

// Claude models that support output_config.effort to cap reasoning effort and reduce latency.
// Only Claude Opus 4.6, Sonnet 4.6, and Opus 4.5 support this parameter.
export const CLAUDE_EFFORT_MODELS = new Set(['claude-4-6-opus', 'claude-4-6-sonnet', 'claude-4-5-opus']);

// Model name prefixes that use the older functions/function_call API
// instead of tools/tool_choice.
export const GEMINI_MODELS = ['gemini-'];
