BASE_URL = "https://llm.atko.ai/v1"

JUDGE_MODEL = "claude-4-5-sonnet"

MAX_TURNS = 30

# Models known to have toolConfig issues with Bedrock
BEDROCK_INCOMPATIBLE_MODELS = [
    "claude-4-5-opus",
    "claude-4-5-sonnet",
    "claude-4-5-haiku",
]
