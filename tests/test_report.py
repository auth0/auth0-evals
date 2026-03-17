"""Happy path tests for report.py."""

import json

from report import grade_color, load_scores, render_html


# ── Helpers ───────────────────────────────────────────────────────────────────


def make_result(eval_id="react_quickstart", model="gpt-5.2", mode="baseline", **kwargs):
    base = {
        "eval_id": eval_id,
        "model": model,
        "mode": mode,
        "status": "success",
        "grader_pass_rate": 1.0,
        "cost_usd": 0.01,
    }
    base.update(kwargs)
    return base


# ── grade_color tests ─────────────────────────────────────────────────────────


def test_grade_color_perfect_pass_rate():
    """A perfect pass rate returns the green colour."""
    assert grade_color(1.0) == "#22c55e"


def test_grade_color_high_pass_rate():
    """A pass rate between 0.75 and 1.0 (exclusive) returns the lime colour."""
    assert grade_color(0.75) == "#84cc16"


def test_grade_color_medium_pass_rate():
    """A pass rate between 0.5 and 0.75 (exclusive) returns the amber colour."""
    assert grade_color(0.5) == "#f59e0b"


def test_grade_color_low_pass_rate():
    """A pass rate below 0.5 returns the red colour."""
    assert grade_color(0.0) == "#ef4444"


# ── render_html tests ─────────────────────────────────────────────────────────


def test_render_html_returns_a_non_empty_string():
    """render_html produces a non-empty string that can be written directly
    to an HTML file."""
    html = render_html([make_result()], generated_at="2024-01-01 00:00")
    assert isinstance(html, str)
    assert len(html) > 0


def test_render_html_contains_eval_id():
    """Each eval_id present in the results appears somewhere in the rendered
    output so the report is traceable back to its source evals."""
    html = render_html([make_result(eval_id="react_quickstart")], generated_at="2024-01-01 00:00")
    assert "react_quickstart" in html


def test_render_html_contains_model_name():
    """Each model name present in the results appears somewhere in the
    rendered output."""
    html = render_html([make_result(model="gpt-5.2")], generated_at="2024-01-01 00:00")
    assert "gpt-5.2" in html


def test_render_html_contains_generated_at():
    """The generated_at timestamp appears in the output so readers know when
    the report was produced."""
    html = render_html([make_result()], generated_at="2024-01-01 12:34")
    assert "2024-01-01 12:34" in html


def test_render_html_includes_all_evals_and_models():
    """Results spanning multiple evals and models are all represented — nothing
    is silently dropped when there is more than one result."""
    results = [
        make_result(eval_id="react_quickstart", model="gpt-5.2"),
        make_result(eval_id="swift_quickstart", model="claude-4-6-sonnet"),
    ]
    html = render_html(results, generated_at="2024-01-01 00:00")
    assert "react_quickstart" in html
    assert "swift_quickstart" in html
    assert "gpt-5.2" in html
    assert "claude-4-6-sonnet" in html


def test_render_html_from_score_files_on_disk(tmp_path):
    """A report built from score files on disk contains the data from those
    files — the full load-then-render pipeline produces the expected output."""
    scores_file = tmp_path / "scores-baseline.json"
    scores_file.write_text(json.dumps([
        make_result(eval_id="react_quickstart", model="gpt-5.2"),
    ]))

    html = render_html(load_scores([str(scores_file)]), generated_at="2024-01-01 00:00")

    assert "react_quickstart" in html
    assert "gpt-5.2" in html
