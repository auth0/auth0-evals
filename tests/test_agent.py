"""Tests for agent_eval/agent.py."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agent_eval.agent import (
    TOOL_DEFINITIONS,
    ToolExecutor,
    _extract_tokens,
    _summarise_args,
    is_gemini_model,
    llm_call,
    run_agent,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def make_task(agent_system_prompt="", user_prompt="Do the task."):
    return SimpleNamespace(
        name="test_task",
        agent_system_prompt=agent_system_prompt,
        user_prompt=user_prompt,
    )


def make_finish_response(summary="Done."):
    return {
        "choices": [{
            "message": {
                "content": None,
                "tool_calls": [{
                    "id": "call_1",
                    "function": {
                        "name": "finish_task",
                        "arguments": json.dumps({"summary": summary}),
                    },
                }],
            },
            "finish_reason": "tool_calls",
        }],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
    }


def make_text_response(content="All done."):
    return {
        "choices": [{
            "message": {"content": content, "tool_calls": None},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }


# ── TOOL_DEFINITIONS tests ────────────────────────────────────────────────────


def test_finish_task_in_tool_definitions():
    names = [t["function"]["name"] for t in TOOL_DEFINITIONS]
    assert "finish_task" in names


def test_finish_task_requires_summary():
    finish = next(t for t in TOOL_DEFINITIONS if t["function"]["name"] == "finish_task")
    assert "summary" in finish["function"]["parameters"]["required"]


def test_all_expected_tools_present():
    names = {t["function"]["name"] for t in TOOL_DEFINITIONS}
    assert names == {"read_file", "write_file", "run_command", "fetch_url", "ask_user", "finish_task"}


# ── tool_choice tests ─────────────────────────────────────────────────────────


def test_llm_call_sends_tool_choice_required():
    captured = {}

    def mock_urlopen(req, timeout=None):
        captured.update(json.loads(req.data))
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "choices": [{"message": {"content": "ok", "tool_calls": None}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    with patch("urllib.request.urlopen", side_effect=mock_urlopen):
        llm_call("key", "gpt-4o", [{"role": "user", "content": "test"}], TOOL_DEFINITIONS)

    assert captured["tool_choice"] == "required"


# ── ToolExecutor.finish_task tests ────────────────────────────────────────────


def test_executor_finish_task_returns_summary(tmp_path):
    executor = ToolExecutor(str(tmp_path))
    result, is_doc, is_interrupt, is_error = executor.execute("finish_task", {"summary": "Done."})

    assert result == "Done."
    assert is_doc is False
    assert is_interrupt is False
    assert is_error is False


def test_executor_finish_task_default_when_no_summary(tmp_path):
    executor = ToolExecutor(str(tmp_path))
    result, _, _, _ = executor.execute("finish_task", {})

    assert result == "Task complete."


# ── _summarise_args tests ─────────────────────────────────────────────────────


def test_summarise_args_finish_task_includes_summary():
    result = _summarise_args("finish_task", {"summary": "Auth0 added."})
    assert "Auth0 added" in result


def test_summarise_args_finish_task_truncates_long_summary():
    result = _summarise_args("finish_task", {"summary": "x" * 100})
    assert len(result) <= 65


# ── _extract_tokens tests ─────────────────────────────────────────────────────


def test_extract_tokens_openai_style():
    input_tokens, output_tokens = _extract_tokens({"prompt_tokens": 10, "completion_tokens": 5})
    assert input_tokens == 10
    assert output_tokens == 5


def test_extract_tokens_anthropic_style():
    input_tokens, output_tokens = _extract_tokens({"input_tokens": 20, "output_tokens": 8})
    assert input_tokens == 20
    assert output_tokens == 8


def test_extract_tokens_defaults_to_zero_when_missing():
    input_tokens, output_tokens = _extract_tokens({})
    assert input_tokens == 0
    assert output_tokens == 0


def test_extract_tokens_zero_values_not_treated_as_missing():
    # An explicit 0 must not fall back to the other naming convention.
    input_tokens, output_tokens = _extract_tokens(
        {"prompt_tokens": 0, "completion_tokens": 0, "input_tokens": 99, "output_tokens": 99}
    )
    assert input_tokens == 0
    assert output_tokens == 0


def test_extract_tokens_openai_style_takes_precedence_over_anthropic():
    input_tokens, output_tokens = _extract_tokens(
        {"prompt_tokens": 10, "completion_tokens": 5, "input_tokens": 20, "output_tokens": 8}
    )
    assert input_tokens == 10
    assert output_tokens == 5


# ── run_agent system prompt tests ─────────────────────────────────────────────


def test_run_agent_injects_agent_system_prompt_as_system_message(tmp_path):
    captured = []

    def mock_llm(api_key, model, messages, tools):
        captured.extend(messages)
        return make_finish_response()

    with patch("agent_eval.agent.llm_call", side_effect=mock_llm):
        run_agent("key", "gpt-4o", make_task(agent_system_prompt="Use tools only."), str(tmp_path))

    system_msgs = [m for m in captured if m["role"] == "system"]
    assert len(system_msgs) == 1
    assert "Use tools only" in system_msgs[0]["content"]


def test_run_agent_omits_system_message_when_no_agent_system_prompt(tmp_path):
    captured = []

    def mock_llm(api_key, model, messages, tools):
        captured.extend(messages)
        return make_finish_response()

    with patch("agent_eval.agent.llm_call", side_effect=mock_llm):
        run_agent("key", "gpt-4o", make_task(agent_system_prompt=""), str(tmp_path))

    system_msgs = [m for m in captured if m["role"] == "system"]
    assert len(system_msgs) == 0


# ── finish_task loop termination tests ────────────────────────────────────────


def test_run_agent_terminates_after_finish_task(tmp_path):
    call_count = {"n": 0}

    def mock_llm(api_key, model, messages, tools):
        call_count["n"] += 1
        return make_finish_response()

    with patch("agent_eval.agent.llm_call", side_effect=mock_llm):
        run_agent("key", "gpt-4o", make_task(), str(tmp_path))

    assert call_count["n"] == 1


def test_run_agent_status_success_on_finish_task(tmp_path):
    with patch("agent_eval.agent.llm_call", return_value=make_finish_response()):
        record = run_agent("key", "gpt-4o", make_task(), str(tmp_path))

    assert record.status == "success"


def test_run_agent_captures_finish_task_summary(tmp_path):
    with patch("agent_eval.agent.llm_call", return_value=make_finish_response("Auth0 integration complete.")):
        record = run_agent("key", "gpt-4o", make_task(), str(tmp_path))

    assert "Auth0 integration complete" in record.final_summary


def test_run_agent_counts_finish_task_as_tool_call(tmp_path):
    with patch("agent_eval.agent.llm_call", return_value=make_finish_response()):
        record = run_agent("key", "gpt-4o", make_task(), str(tmp_path))

    assert len(record.tool_calls) == 1
    assert record.tool_calls[0].name == "finish_task"


def test_run_agent_terminates_gracefully_on_empty_tool_calls(tmp_path):
    with patch("agent_eval.agent.llm_call", return_value=make_text_response("All done.")):
        record = run_agent("key", "gpt-4o", make_task(), str(tmp_path))

    assert record.status == "success"
    assert record.final_summary == "All done."


# ── Gemini helpers ─────────────────────────────────────────────────────────────


def make_gemini_finish_response(summary="Done."):
    """Simulate Gemini's function_call response format."""
    return {
        "choices": [{
            "message": {
                "content": None,
                "tool_calls": None,
                "function_call": {
                    "name": "finish_task",
                    "arguments": json.dumps({"summary": summary}),
                },
            },
            "finish_reason": "function_call",
        }],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
    }


# ── is_gemini_model tests ──────────────────────────────────────────────────────


def test_is_gemini_model_detects_gemini_prefix():
    assert is_gemini_model("gemini-3-pro-preview") is True
    assert is_gemini_model("gemini-2.5-pro") is True


def test_is_gemini_model_returns_false_for_non_gemini():
    assert is_gemini_model("gpt-4o") is False
    assert is_gemini_model("claude-4-6-sonnet") is False


# ── Gemini llm_call tests ──────────────────────────────────────────────────────


def test_llm_call_sends_functions_api_for_gemini():
    """Gemini requests must use functions/function_call, not tools/tool_choice."""
    captured = {}

    def mock_urlopen(req, timeout=None):
        captured.update(json.loads(req.data))
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "choices": [{"message": {"content": "ok", "tool_calls": None}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    with patch("urllib.request.urlopen", side_effect=mock_urlopen):
        llm_call("key", "gemini-3-pro-preview", [{"role": "user", "content": "test"}], TOOL_DEFINITIONS)

    assert "functions" in captured
    assert captured.get("function_call") == "auto"
    assert "tools" not in captured
    assert "tool_choice" not in captured


def test_llm_call_gemini_functions_match_tool_definitions():
    """functions sent to Gemini must cover all tools defined in TOOL_DEFINITIONS."""
    captured = {}

    def mock_urlopen(req, timeout=None):
        captured.update(json.loads(req.data))
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "choices": [{"message": {"content": "ok", "tool_calls": None}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    with patch("urllib.request.urlopen", side_effect=mock_urlopen):
        llm_call("key", "gemini-2.5-pro", [{"role": "user", "content": "test"}], TOOL_DEFINITIONS)

    expected_names = {t["function"]["name"] for t in TOOL_DEFINITIONS}
    actual_names = {f["name"] for f in captured["functions"]}
    assert actual_names == expected_names


# ── Gemini run_agent tests ─────────────────────────────────────────────────────


def test_run_agent_normalises_gemini_function_call_response(tmp_path):
    """run_agent must handle Gemini's function_call format and complete successfully."""
    with patch("agent_eval.agent.llm_call", return_value=make_gemini_finish_response("Gemini done.")):
        record = run_agent("key", "gemini-3-pro-preview", make_task(), str(tmp_path))

    assert record.status == "success"
    assert "Gemini done" in record.final_summary


def test_run_agent_sends_function_role_for_gemini_tool_results(tmp_path):
    """Tool results for Gemini must be returned as role=function messages."""
    captured_messages = []

    read_response = {
        "choices": [{
            "message": {
                "content": None,
                "tool_calls": None,
                "function_call": {
                    "name": "read_file",
                    "arguments": json.dumps({"path": "src/App.js"}),
                },
            },
            "finish_reason": "function_call",
        }],
        "usage": {"prompt_tokens": 50, "completion_tokens": 20},
    }

    call_count = {"n": 0}

    def mock_llm(api_key, model, messages, tools):
        captured_messages.extend(messages)
        call_count["n"] += 1
        return read_response if call_count["n"] == 1 else make_gemini_finish_response()

    with patch("agent_eval.agent.llm_call", side_effect=mock_llm):
        run_agent("key", "gemini-3-pro-preview", make_task(), str(tmp_path))

    function_msgs = [m for m in captured_messages if m.get("role") == "function"]
    assert len(function_msgs) == 1
    assert function_msgs[0]["name"] == "read_file"
