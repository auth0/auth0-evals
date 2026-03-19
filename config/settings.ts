export const BASE_URL = '<LLM_PROXY_URL>/v1';

export const JUDGE_MODEL = 'claude-4-5-sonnet';

export const JUDGE_MAX_TOKENS = 300;

export const MAX_TURNS = 30;

// Model name prefixes routed through Bedrock — require special handling
// (XML tool calls, no tool_choice, results as user messages).
export const BEDROCK_MODELS = ['claude-'];

// Model name prefixes that use the older functions/function_call API
// instead of tools/tool_choice.
export const GEMINI_MODELS = ['gemini-'];
