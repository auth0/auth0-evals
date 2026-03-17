"""Happy path tests for agent_eval/scorer.py."""

import pytest

from agent_eval.agent import RunRecord, ToolCallRecord
from agent_eval.graders import GraderResult
from agent_eval.scorer import score, score_to_grade


# ── Helpers ───────────────────────────────────────────────────────────────────


def make_record(**kwargs) -> RunRecord:
    defaults = dict(task_name="test-task", model="test-model")
    defaults.update(kwargs)
    return RunRecord(**defaults)


def make_tool_call(name="read_file", duration=1.0, **kwargs) -> ToolCallRecord:
    tc = ToolCallRecord(
        name=name, args={}, result="ok",
        start_time=0.0, end_time=duration,
    )
    for k, v in kwargs.items():
        setattr(tc, k, v)
    return tc


def get_dim(result, name: str):
    """Return the DimensionScore whose name matches *name* from a ScoredResult."""
    return next(d for d in result.dimensions if d.name == name)


# ── score_to_grade tests ──────────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    (100.0, "A"),
    (90.0,  "A"),
    (89.9,  "B"),
    (75.0,  "B"),
    (74.9,  "C"),
    (60.0,  "C"),
    (59.9,  "D"),
    (40.0,  "D"),
    (39.9,  "F"),
    (0.0,   "F"),
])
def test_score_to_grade(raw, expected):
    """Numeric scores map to letter grades at published thresholds
    (A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F otherwise)."""
    assert score_to_grade(raw) == expected


# ── Setup Friction tests ──────────────────────────────────────────────────────


def test_score_friction_no_interruptions_no_errors(tmp_path):
    """A run with no interruptions and no provider errors achieves a perfect
    friction score — the agent completed the task without any assistance."""
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Setup Friction").raw_score == 100.0


def test_score_friction_penalises_each_interruption(tmp_path):
    """Each time the agent had to pause and ask the user for help the friction
    score decreases — more interruptions means a worse developer experience."""
    record = make_record(workspace=str(tmp_path))
    record.tool_calls = [make_tool_call(is_interruption=True) for _ in range(2)]
    result = score(record)
    assert get_dim(result, "Setup Friction").raw_score < 100.0


def test_score_friction_penalises_provider_errors(tmp_path):
    """Provider errors (e.g. rate limits, timeouts) reduce the friction score
    because they force the agent to stall or retry."""
    record = make_record(workspace=str(tmp_path))
    record.provider_errors = ["timeout", "rate limit"]
    result = score(record)
    assert get_dim(result, "Setup Friction").raw_score < 100.0


def test_score_friction_clamps_to_zero(tmp_path):
    """The friction score cannot go below zero regardless of how many
    interruptions occurred."""
    record = make_record(workspace=str(tmp_path))
    record.tool_calls = [make_tool_call(is_interruption=True) for _ in range(10)]
    result = score(record)
    assert get_dim(result, "Setup Friction").raw_score == 0.0


# ── Setup Speed tests ─────────────────────────────────────────────────────────


def test_score_speed_exactly_at_reference(tmp_path):
    """Active time equal to the reference budget achieves a perfect speed score
    — the agent completed the task in the expected time."""
    record = make_record(workspace=str(tmp_path))
    record.tool_calls = [make_tool_call(duration=60.0)]
    result = score(record)
    assert get_dim(result, "Setup Speed").raw_score == 100.0


def test_score_speed_below_reference(tmp_path):
    """Completing faster than the reference budget also achieves a perfect
    speed score — finishing early is not penalised."""
    record = make_record(workspace=str(tmp_path))
    record.tool_calls = [make_tool_call(duration=30.0)]
    result = score(record)
    assert get_dim(result, "Setup Speed").raw_score == 100.0


def test_score_speed_degrades_beyond_reference(tmp_path):
    """Active time beyond the reference budget reduces the speed score
    — the longer the agent takes, the lower the score."""
    record = make_record(workspace=str(tmp_path))
    record.tool_calls = [make_tool_call(duration=110.0)]  # 50 s over 60 s reference
    result = score(record)
    assert get_dim(result, "Setup Speed").raw_score == pytest.approx(100.0 - 50.0 * 0.4)


# ── Efficiency tests ──────────────────────────────────────────────────────────


def test_score_efficiency_no_tool_calls_is_na(tmp_path):
    """Baseline and skills modes that use no tools receive a neutral efficiency
    score because the dimension does not apply to them."""
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Efficiency").raw_score == 100.0


def test_score_efficiency_at_ideal_call_count(tmp_path):
    """Using exactly the ideal number of tool calls achieves a perfect
    efficiency score — the agent took the most direct path."""
    record = make_record(workspace=str(tmp_path))
    record.tool_calls = [make_tool_call() for _ in range(10)]
    result = score(record)
    assert get_dim(result, "Efficiency").raw_score == 100.0


def test_score_efficiency_degrades_above_ideal(tmp_path):
    """Using more tool calls than ideal reduces the efficiency score — extra
    calls indicate the agent thrashed or took an indirect path."""
    record = make_record(workspace=str(tmp_path))
    record.tool_calls = [make_tool_call() for _ in range(20)]
    result = score(record)
    assert get_dim(result, "Efficiency").raw_score < 100.0


def test_score_efficiency_notes_include_tool_summary(tmp_path):
    """The notes include a human-readable breakdown of which tools were used so
    reviewers can see the agent's action pattern at a glance."""
    record = make_record(workspace=str(tmp_path))
    record.tool_calls = [make_tool_call("read_file") for _ in range(3)]
    result = score(record)
    assert "Read" in get_dim(result, "Efficiency").notes


# ── Error Recovery tests ──────────────────────────────────────────────────────


def test_score_errors_no_provider_errors(tmp_path):
    """A run with no provider errors achieves a perfect error-recovery score
    — the SDK behaved correctly on first use."""
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Error Recovery").raw_score == 100.0


def test_score_errors_penalises_each_provider_error(tmp_path):
    """Provider errors reduce the error-recovery score — they indicate the
    agent hit unexpected failures during the integration."""
    record = make_record(workspace=str(tmp_path))
    record.provider_errors = ["timeout"]
    result = score(record)
    assert get_dim(result, "Error Recovery").raw_score < 100.0


def test_score_errors_clamps_to_zero(tmp_path):
    """The error-recovery score cannot go below zero regardless of how many
    provider errors occurred."""
    record = make_record(workspace=str(tmp_path))
    record.provider_errors = [f"err{i}" for i in range(10)]
    result = score(record)
    assert get_dim(result, "Error Recovery").raw_score == 0.0


# ── Docs Quality tests ────────────────────────────────────────────────────────


def test_score_docs_all_features_present(tmp_path):
    """All five AI-discoverability features present yields a perfect docs
    score — the SDK is fully discoverable by an agent."""
    features = {
        "llms_txt": True,
        "context7": True,
        "mcp_server": True,
        "typed_sdk": True,
        "openapi_spec": True,
    }
    record = make_record(workspace=str(tmp_path))
    result = score(record, doc_features=features)
    assert get_dim(result, "Docs Quality").raw_score == 100.0


def test_score_docs_no_features(tmp_path):
    """No AI-discoverability features yields a zero docs score — an agent
    has no automated way to learn about the SDK."""
    features = {k: False for k in ["llms_txt", "context7", "mcp_server", "typed_sdk", "openapi_spec"]}
    record = make_record(workspace=str(tmp_path))
    result = score(record, doc_features=features)
    assert get_dim(result, "Docs Quality").raw_score == 0.0


def test_score_docs_partial_features(tmp_path):
    """The docs score is proportional to the number of features present —
    each feature contributes equally."""
    features = {
        "llms_txt": True,
        "context7": False,
        "mcp_server": True,
        "typed_sdk": False,
        "openapi_spec": False,
    }
    record = make_record(workspace=str(tmp_path))
    result = score(record, doc_features=features)
    assert get_dim(result, "Docs Quality").raw_score == 40.0


# ── Correctness tests ─────────────────────────────────────────────────────────


def test_score_correctness_all_pass(tmp_path):
    """All graders passing yields a perfect correctness score — the agent
    produced exactly what the eval required."""
    grader_results = [
        GraderResult("a", "contains", True, ""),
        GraderResult("b", "contains", True, ""),
    ]
    record = make_record(workspace=str(tmp_path))
    result = score(record, grader_results=grader_results)
    assert get_dim(result, "Correctness").raw_score == 100.0


def test_score_correctness_half_pass(tmp_path):
    """The correctness score is the proportion of graders that passed —
    partially correct output is reflected in the score."""
    grader_results = [
        GraderResult("a", "contains", True, ""),
        GraderResult("b", "contains", False, ""),
    ]
    record = make_record(workspace=str(tmp_path))
    result = score(record, grader_results=grader_results)
    assert get_dim(result, "Correctness").raw_score == 50.0


def test_score_correctness_none_pass(tmp_path):
    """No graders passing yields a zero correctness score — the agent's
    output did not satisfy any of the eval's requirements."""
    grader_results = [GraderResult("a", "contains", False, "")]
    record = make_record(workspace=str(tmp_path))
    result = score(record, grader_results=grader_results)
    assert get_dim(result, "Correctness").raw_score == 0.0


def test_score_correctness_empty_graders(tmp_path):
    """With no graders to evaluate correctness scores zero — the absence of
    checks is treated conservatively rather than as a passing state."""
    record = make_record(workspace=str(tmp_path))
    result = score(record, grader_results=[])
    assert get_dim(result, "Correctness").raw_score == 0.0


# ── Hallucination tests ───────────────────────────────────────────────────────


def test_score_hallucination_clean_react_code(tmp_path):
    """Code that uses only real @auth0/auth0-react imports scores perfectly on
    hallucination — no fabricated APIs or packages."""
    (tmp_path / "App.jsx").write_text(
        "import { useAuth0, Auth0Provider } from '@auth0/auth0-react';\n"
        "export default function App() { return <div/>; }"
    )
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Hallucination").raw_score == 100.0


def test_score_hallucination_detects_fake_python_import(tmp_path):
    """Importing a non-existent Auth0Client class from the auth0 package is
    flagged as a hallucination and the affected file is identified."""
    (tmp_path / "app.py").write_text("from auth0 import Auth0Client\n")
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    dim = get_dim(result, "Hallucination")
    assert dim.raw_score < 100.0
    assert "app.py" in dim.notes


def test_score_hallucination_detects_fake_js_package(tmp_path):
    """Importing from @auth0/auth0-sdk (a package that does not exist) is
    flagged as a hallucination."""
    (tmp_path / "app.js").write_text("import @auth0/auth0-sdk\n")
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Hallucination").raw_score < 100.0


def test_score_hallucination_empty_workspace(tmp_path):
    """With no code files to scan there are no hallucinations to detect."""
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Hallucination").raw_score == 100.0


# ── Security tests ────────────────────────────────────────────────────────────


def test_score_security_env_vars_only(tmp_path):
    """Reading credentials from environment variables is the correct pattern
    and scores perfectly — no secrets are exposed in source code."""
    (tmp_path / "App.js").write_text(
        "const domain = process.env.REACT_APP_AUTH0_DOMAIN;\n"
        "const clientId = process.env.REACT_APP_AUTH0_CLIENT_ID;"
    )
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Security").raw_score == 100.0


def test_score_security_detects_hardcoded_client_secret(tmp_path):
    """A hardcoded client_secret in source code is flagged as a security
    vulnerability and the affected file is identified."""
    (tmp_path / "auth.js").write_text("const client_secret = 'my-super-secret-value';")
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    dim = get_dim(result, "Security")
    assert dim.raw_score < 100.0
    assert "auth.js" in dim.notes


def test_score_security_detects_hardcoded_api_key(tmp_path):
    """A hardcoded API key in source code is flagged as a security
    vulnerability — credentials must not be committed."""
    (tmp_path / "config.js").write_text("const api_key = 'sk-abc123';")
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Security").raw_score < 100.0


def test_score_security_empty_workspace(tmp_path):
    """With no code files to scan there are no security issues to detect."""
    record = make_record(workspace=str(tmp_path))
    result = score(record)
    assert get_dim(result, "Security").raw_score == 100.0


# ── score() integration tests ─────────────────────────────────────────────────


def test_score_returns_eight_dimensions(tmp_path):
    """Scoring always produces results across all eight evaluation dimensions
    so every aspect of an agent run is represented."""
    record = make_record(workspace=str(tmp_path))
    result = score(record, grader_results=[])
    assert len(result.dimensions) == 8


def test_score_overall_grade_is_valid_letter(tmp_path):
    """The overall grade is always a valid letter grade so the result can be
    displayed in a report without additional validation."""
    record = make_record(workspace=str(tmp_path))
    result = score(record, grader_results=[])
    assert result.overall_grade in ("A", "B", "C", "D", "F")


def test_score_overall_score_is_within_range(tmp_path):
    """The overall score is always between 0 and 100 so downstream consumers
    can rely on it being a valid percentage."""
    record = make_record(workspace=str(tmp_path))
    result = score(record, grader_results=[])
    assert 0.0 <= result.overall_score <= 100.0


def test_score_grader_pass_rate_with_all_passing(tmp_path):
    """The grader pass rate on the scored result reflects the underlying grader
    outcomes rather than being a separate calculation."""
    record = make_record(workspace=str(tmp_path))
    grader_results = [GraderResult("a", "contains", True, "")]
    result = score(record, grader_results=grader_results)
    assert result.grader_pass_rate == 1.0
