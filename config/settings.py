BASE_URL = "<LLM_PROXY_URL>/v1"

JUDGE_MODEL = "claude-4-5-sonnet"

MAX_TURNS = 30

# Model name prefixes routed through Bedrock — require special handling
# (XML tool calls, no tool_choice, results as user messages).
# Using a prefix means all current and future Claude models are covered
# without needing individual entries.
BEDROCK_MODELS = [
    "claude-",
]

# Model name prefixes that use the older functions/function_call API
# instead of tools/tool_choice.
GEMINI_MODELS = [
    "gemini-",
]
