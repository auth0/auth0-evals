"""
Baseline runner — pure LLM, no tools.

Sends the eval prompt directly to the LLM as a single chat completion.
Graders run against the text of the LLM response (treated as a virtual file).
No workspace, no tool execution, no agentic loop.

Equivalent to exec.ts "Baseline" mode in the reference architecture.
"""

import json
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path

BASE_URL = "https://llm.atko.ai/v1"


@dataclass
class BaselineResult:
    eval_id: str
    model: str
    mode: str = "baseline"
    session_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    response_text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    wall_time: float = 0.0
    status: str = "success"
    error: str = ""


def run_baseline(
    api_key: str,
    model: str,
    eval_def,           # EvalDefinition from loader.py
) -> BaselineResult:
    """
    Run a single LLM call against the eval prompt. Return BaselineResult.
    """
    result = BaselineResult(eval_id=eval_def.id, model=model)
    t_start = time.time()

    messages = [
        {"role": "system", "content": eval_def.system_prompt},
        {"role": "user",   "content": eval_def.user_prompt},
    ]

    try:
        response = _llm_call(api_key, model, messages)
        usage = response.get("usage", {})
        result.input_tokens  = usage.get("prompt_tokens", 0)
        result.output_tokens = usage.get("completion_tokens", 0)
        result.response_text = response["choices"][0]["message"].get("content", "")
        result.cost_usd = _estimate_cost(model, result.input_tokens, result.output_tokens)
    except Exception as e:
        result.status = "failure"
        result.error  = str(e)

    result.wall_time = time.time() - t_start
    return result


# ── LLM call ──────────────────────────────────────────────────────────────────

def _llm_call(api_key: str, model: str, messages: list[dict]) -> dict:
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": 0.0,
    }).encode()

    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"LLM API error {e.code}: {body[:400]}") from e


# ── Cost estimate ─────────────────────────────────────────────────────────────

_COST_TABLE = {
    "gpt-4o":           (5.0,  15.0),
    "gpt-4o-mini":      (0.15,  0.60),
    "claude-4-5-sonnet": (3.0,  15.0),
    "claude-4-5-opus":  (15.0,  75.0),
    "claude-4-6-sonnet": (3.0,  15.0),
}

def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    in_p, out_p = _COST_TABLE.get(model, (1.0, 5.0))
    return (input_tokens * in_p + output_tokens * out_p) / 1_000_000
