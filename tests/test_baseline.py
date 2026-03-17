"""Happy path tests for runners/baseline.py."""

from types import SimpleNamespace
from unittest.mock import patch

from config.costs import estimate_cost
from runners.baseline import BaselineResult, run_baseline


# ── Helpers ───────────────────────────────────────────────────────────────────


def make_eval_def(eval_id="react_quickstart"):
    return SimpleNamespace(
        id=eval_id,
        system_prompt="You are a React developer.",
        user_prompt="Add Auth0 authentication to the app.",
    )


def make_llm_response(content="Here is the code.", input_tokens=100, output_tokens=200):
    return {
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": input_tokens, "completion_tokens": output_tokens},
    }


# ── _estimate_cost tests ──────────────────────────────────────────────────────


def test_estimate_cost_known_model_input_tokens():
    """A known model uses the correct per-token input price from the cost table."""
    cost = estimate_cost("gpt-5.2", input_tokens=1_000_000, output_tokens=0)
    assert cost == 10.0


def test_estimate_cost_known_model_output_tokens():
    """A known model uses the correct per-token output price from the cost table."""
    cost = estimate_cost("gpt-5.2", input_tokens=0, output_tokens=1_000_000)
    assert cost == 30.0


def test_estimate_cost_sums_input_and_output():
    """Total cost is the sum of input and output token costs, priced separately."""
    cost = estimate_cost("gpt-5.2", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost == 40.0


def test_estimate_cost_unknown_model_uses_defaults():
    """An unrecognised model falls back to a default price rather than raising,
    so a new or misspelled model name never crashes the eval."""
    cost = estimate_cost("unknown-model", input_tokens=1_000_000, output_tokens=0)
    assert cost == 1.0


def test_estimate_cost_zero_tokens():
    """Zero tokens produce a zero cost — nothing was consumed."""
    cost = estimate_cost("gpt-5.2", input_tokens=0, output_tokens=0)
    assert cost == 0.0


# ── run_baseline tests ────────────────────────────────────────────────────────


def test_run_baseline_returns_baseline_result():
    """run_baseline returns a BaselineResult tagged with the eval id and model
    so callers can associate the result with the right eval."""
    with patch("runners.baseline._llm_call", return_value=make_llm_response()):
        result = run_baseline("key", "gpt-5.2", make_eval_def())
    assert isinstance(result, BaselineResult)
    assert result.eval_id == "react_quickstart"
    assert result.model == "gpt-5.2"


def test_run_baseline_mode_is_baseline():
    """The result always identifies its mode as 'baseline' so downstream code
    can distinguish it from skills and agent results."""
    with patch("runners.baseline._llm_call", return_value=make_llm_response()):
        result = run_baseline("key", "gpt-5.2", make_eval_def())
    assert result.mode == "baseline"


def test_run_baseline_captures_response_text():
    """The LLM's reply is stored as response_text so graders can inspect it."""
    with patch("runners.baseline._llm_call", return_value=make_llm_response(content="Auth0 code here")):
        result = run_baseline("key", "gpt-5.2", make_eval_def())
    assert result.response_text == "Auth0 code here"


def test_run_baseline_captures_token_counts():
    """Input and output token counts from the API usage field are stored on the
    result so cost and reporting are accurate."""
    response = make_llm_response(input_tokens=500, output_tokens=250)
    with patch("runners.baseline._llm_call", return_value=response):
        result = run_baseline("key", "gpt-5.2", make_eval_def())
    assert result.input_tokens == 500
    assert result.output_tokens == 250


def test_run_baseline_calculates_cost_from_token_counts():
    """Cost is derived from the token counts in the API response using the
    model's price table entry."""
    response = make_llm_response(input_tokens=1_000_000, output_tokens=0)
    with patch("runners.baseline._llm_call", return_value=response):
        result = run_baseline("key", "gpt-5.2", make_eval_def())
    assert result.cost_usd == 10.0


def test_run_baseline_status_success_on_happy_path():
    """A successful LLM call produces a result with status 'success'."""
    with patch("runners.baseline._llm_call", return_value=make_llm_response()):
        result = run_baseline("key", "gpt-5.2", make_eval_def())
    assert result.status == "success"


def test_run_baseline_status_failure_on_error():
    """When the LLM call raises an exception the result status is 'failure'
    and the error message is recorded, rather than propagating the exception."""
    with patch("runners.baseline._llm_call", side_effect=RuntimeError("timeout")):
        result = run_baseline("key", "gpt-5.2", make_eval_def())
    assert result.status == "failure"
    assert "timeout" in result.error


def test_run_baseline_records_wall_time():
    """Wall time is recorded so reports can show how long the LLM call took."""
    with patch("runners.baseline._llm_call", return_value=make_llm_response()):
        result = run_baseline("key", "gpt-5.2", make_eval_def())
    assert isinstance(result.wall_time, float)
    assert result.wall_time >= 0.0
