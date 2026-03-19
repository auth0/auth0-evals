"""
Grader primitives.

Each eval task defines a list of graders. After the agent finishes,
run_graders() evaluates all written files against them and returns
pass/fail per grader.

Primitives:
  contains(needle)          — substring present in any written file
  not_contains(needle)      — substring must NOT appear in any written file
  matches(pattern)          — regex match in any written file
  judge(question, framework=None) — LLM-as-judge yes/no question about the code
"""

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from config.settings import BASE_URL, JUDGE_MAX_TOKENS, JUDGE_MODEL

_JUDGE_PROMPTS_DIR = Path(__file__).parent.parent / "prompts" / "judge"


def _load_framework_prompt(framework: str | None) -> str:
    """Load judge system prompt from a markdown file in prompts/judge/."""
    name = framework if framework and (_JUDGE_PROMPTS_DIR / f"{framework}.md").exists() else "default"
    return (_JUDGE_PROMPTS_DIR / f"{name}.md").read_text().strip()


def _load_user_template() -> str:
    """Load judge user message template from prompts/judge/user_template.md."""
    return (_JUDGE_PROMPTS_DIR / "user_template.md").read_text().strip()


# ── Result type ───────────────────────────────────────────────────────────────

@dataclass
class GraderResult:
    name: str
    kind: str          # "contains" | "not_contains" | "matches" | "judge"
    passed: bool
    detail: str        # what was checked / why it passed or failed


# ── Workspace helpers ─────────────────────────────────────────────────────────

def _collect_files(workspace: str) -> dict[str, str]:
    """Return {relative_path: content} for every text file in workspace."""
    files: dict[str, str] = {}
    for path in Path(workspace).rglob("*"):
        if path.is_file() and not any(
            p in path.parts for p in (".build", ".git", "__pycache__")
        ):
            try:
                files[str(path.relative_to(workspace))] = path.read_text(errors="replace")
            except Exception:
                pass
    return files


def _combined(files: dict[str, str]) -> str:
    return "\n\n".join(f"// FILE: {k}\n{v}" for k, v in files.items())


# ── Grader factories ──────────────────────────────────────────────────────────

def contains(needle: str, description: str | None = None) -> dict:
    """Pass if `needle` appears (case-insensitive) in any written file."""
    return {
        "kind": "contains",
        "needle": needle,
        "name": description or f"contains '{needle}'",
    }


def not_contains(needle: str, description: str | None = None) -> dict:
    """Pass if `needle` does NOT appear (case-insensitive) in any written file."""
    return {
        "kind": "not_contains",
        "needle": needle,
        "name": description or f"not_contains '{needle}'",
    }


def matches(pattern: str, description: str | None = None) -> dict:
    """Pass if regex `pattern` matches anywhere across all written files."""
    return {
        "kind": "matches",
        "pattern": pattern,
        "name": description or f"matches /{pattern}/",
    }


def judge(question: str, framework: str | None = None) -> dict:
    """Pass if LLM judge answers 'yes' to `question` about the generated code.

    `framework` sets the judge's context (e.g. 'react', 'ios'). Falls back to a generic Auth0 prompt if an unknown or no framework is provided.
    """
    return {
        "kind": "judge",
        "question": question,
        "framework": framework,
        "name": question[:80],
    }


# ── Runner ────────────────────────────────────────────────────────────────────

def run_graders(
    grader_defs: list[dict],
    workspace: str,
    api_key: str,
    judge_model: str = JUDGE_MODEL,
) -> list[GraderResult]:
    """Evaluate all graders against the files in workspace. Returns results."""
    files = _collect_files(workspace)
    combined = _combined(files)
    results: list[GraderResult] = []

    combined_lower = combined.lower()

    for g in grader_defs:
        kind = g["kind"]
        name = g["name"]

        if kind == "contains":
            needle = g["needle"]
            passed = needle.lower() in combined_lower
            detail = f"'{needle}' {'found' if passed else 'NOT found'} in written files"
            results.append(GraderResult(name=name, kind=kind, passed=passed, detail=detail))

        elif kind == "not_contains":
            needle = g["needle"]
            passed = needle.lower() not in combined_lower
            detail = f"'{needle}' {'NOT found (good)' if passed else 'FOUND (bad)'} in written files"
            results.append(GraderResult(name=name, kind=kind, passed=passed, detail=detail))

        elif kind == "matches":
            pattern = g["pattern"]
            try:
                passed = bool(re.search(pattern, combined, re.IGNORECASE | re.MULTILINE))
            except re.error as e:
                passed = False
                pattern = f"(invalid regex: {e})"
            detail = f"/{pattern}/ {'matched' if passed else 'NOT matched'}"
            results.append(GraderResult(name=name, kind=kind, passed=passed, detail=detail))

        elif kind == "judge":
            question = g["question"]
            framework = g.get("framework")
            passed, detail = _llm_judge(question, combined, api_key, judge_model, framework)
            results.append(GraderResult(name=name, kind=kind, passed=passed, detail=detail))

        else:
            results.append(GraderResult(name=name, kind=kind, passed=False, detail=f"Unknown grader kind: {kind}"))

    return results


def _llm_judge(question: str, code: str, api_key: str, model: str, framework: str | None = None) -> tuple[bool, str]:
    """Ask the LLM judge a yes/no question about the generated code."""
    base = _load_framework_prompt(framework)
    system = (
        f"{base} Reply with 'yes' or 'no' on the first line, "
        "then a brief explanation of your reasoning on the following lines."
    )
    user = _load_user_template().format(question=question, code=code[:6000])

    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "temperature": 0.0,
        "max_tokens": JUDGE_MAX_TOKENS,
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
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        answer = data["choices"][0]["message"]["content"].strip()
        if not answer:
            return False, f"Judge ({model}) error: empty response"
        first_line = answer.splitlines()[0].lower()
        m = re.match(r"^(yes|no)\b", first_line)
        if not m:
            return False, f"Judge ({model}) error: unexpected verdict {first_line!r}: {answer}"
        passed = m.group(1) == "yes"
        return passed, f"Judge ({model}): {answer}"
    except Exception as e:
        return False, f"Judge ({model}) error: {e}"


# ── Summary helpers ───────────────────────────────────────────────────────────

def pass_rate(results: list[GraderResult]) -> float:
    if not results:
        return 1.0
    return sum(1 for r in results if r.passed) / len(results)
