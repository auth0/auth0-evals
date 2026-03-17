"""Happy path tests for agent_eval/graders.py."""

import pytest
from agent_eval.graders import (
    GraderResult,
    contains,
    matches,
    pass_rate,
    run_graders,
)


# ── run_graders — contains ────────────────────────────────────────────────────


def test_run_graders_contains_passes_when_needle_present(tmp_path):
    """A contains grader passes when the expected string appears in any
    workspace file. The custom description becomes the result name so it is
    readable in reports."""
    (tmp_path / "App.js").write_text("import { Auth0Provider } from '@auth0/auth0-react';")
    graders = [contains("Auth0Provider", description="imports Auth0Provider")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert len(results) == 1
    assert results[0].passed is True
    assert results[0].kind == "contains"
    assert results[0].name == "imports Auth0Provider"


def test_run_graders_contains_fails_when_needle_absent(tmp_path):
    """A contains grader fails when the expected string is not present anywhere
    in the workspace."""
    (tmp_path / "App.js").write_text("import React from 'react';")
    graders = [contains("Auth0Provider")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is False


def test_run_graders_contains_is_case_insensitive(tmp_path):
    """Contains matching ignores letter case so 'Auth0Provider' and
    'auth0provider' both satisfy the same grader."""
    (tmp_path / "app.js").write_text("auth0provider is used here")
    graders = [contains("Auth0Provider")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is True


def test_run_graders_ignores_git_directory(tmp_path):
    """Content inside a .git directory is not scanned — version control
    metadata should never influence grading outcomes."""
    git_dir = tmp_path / ".git"
    git_dir.mkdir()
    (git_dir / "COMMIT_EDITMSG").write_text("Auth0Provider is mentioned here")
    (tmp_path / "App.js").write_text("import React from 'react';")
    graders = [contains("Auth0Provider")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is False


def test_run_graders_ignores_pycache_directory(tmp_path):
    """Content inside __pycache__ is not scanned — compiled artefacts should
    never influence grading outcomes."""
    cache_dir = tmp_path / "__pycache__"
    cache_dir.mkdir()
    (cache_dir / "app.pyc").write_text("Auth0Provider cached bytecode")
    (tmp_path / "app.py").write_text("import react")
    graders = [contains("Auth0Provider")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is False


# ── run_graders — matches ─────────────────────────────────────────────────────


def test_run_graders_matches_passes_when_pattern_present(tmp_path):
    """A matches grader passes when the regex finds at least one match across
    all workspace files. The custom description becomes the result name so it
    is readable in reports."""
    (tmp_path / "App.js").write_text("const { loginWithRedirect } = useAuth0();")
    graders = [matches(r"useAuth0\(\)", description="calls useAuth0 hook")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is True
    assert results[0].kind == "matches"
    assert results[0].name == "calls useAuth0 hook"


def test_run_graders_matches_fails_when_pattern_absent(tmp_path):
    """A matches grader fails when the regex finds no match in any file."""
    (tmp_path / "App.js").write_text("import React from 'react';")
    graders = [matches(r"useAuth0\(\)")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is False


def test_run_graders_invalid_regex_fails_gracefully(tmp_path):
    """A malformed regex pattern fails the grader rather than raising an
    exception that would abort the entire eval."""
    (tmp_path / "App.js").write_text("some code")
    graders = [matches(r"[invalid")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is False
    assert results[0].kind == "matches"


# ── run_graders — edge cases ──────────────────────────────────────────────────


def test_run_graders_unknown_kind_fails(tmp_path):
    """An unrecognised grader kind produces a failed result rather than
    crashing, so the rest of the eval can still complete."""
    (tmp_path / "App.js").write_text("some code")
    graders = [{"kind": "unknown", "name": "test grader"}]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is False


def test_run_graders_multiple_graders_all_pass(tmp_path):
    """Each grader in the list is evaluated independently, and all pass when
    all of their criteria are met."""
    (tmp_path / "App.js").write_text(
        "import { Auth0Provider } from '@auth0/auth0-react';\n"
        "const { loginWithRedirect } = useAuth0();"
    )
    graders = [contains("Auth0Provider"), matches(r"useAuth0\(\)")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert len(results) == 2
    assert all(r.passed for r in results)


def test_run_graders_multiple_graders_mixed_results(tmp_path):
    """Graders that find their target pass while those that do not fail
    independently — one grader's result does not affect another's."""
    (tmp_path / "App.js").write_text("import { Auth0Provider } from '@auth0/auth0-react';")
    graders = [contains("Auth0Provider"), contains("useAuth0")]

    results = run_graders(graders, str(tmp_path), api_key="unused")

    assert results[0].passed is True
    assert results[1].passed is False


# ── pass_rate tests ───────────────────────────────────────────────────────────


def test_pass_rate_all_passing():
    """When every grader passes the rate is 1.0 (100%)."""
    results = [
        GraderResult("a", "contains", True, ""),
        GraderResult("b", "contains", True, ""),
    ]
    assert pass_rate(results) == 1.0


def test_pass_rate_none_passing():
    """When no grader passes the rate is 0.0 (0%)."""
    results = [
        GraderResult("a", "contains", False, ""),
        GraderResult("b", "contains", False, ""),
    ]
    assert pass_rate(results) == 0.0


def test_pass_rate_half_passing():
    """The rate reflects the proportion of graders that passed."""
    results = [
        GraderResult("a", "contains", True, ""),
        GraderResult("b", "contains", False, ""),
    ]
    assert pass_rate(results) == 0.5


def test_pass_rate_empty_list_returns_one():
    """With no graders to evaluate the run is considered fully passing — an
    absence of checks should not penalise a result."""
    assert pass_rate([]) == 1.0
