"""
Grader primitives.

Each eval task defines a list of graders. After the agent finishes,
run_graders() evaluates all written files against them and returns
pass/fail per grader.

Three primitives:
  contains(needle)          — substring present in any written file
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

BASE_URL = "https://llm.atko.ai/v1"
JUDGE_MODEL = "claude-4-5-sonnet"

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
    kind: str          # "contains" | "matches" | "judge"
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

    for g in grader_defs:
        kind = g["kind"]
        name = g["name"]

        if kind == "contains":
            needle = g["needle"]
            passed = needle.lower() in combined.lower()
            detail = f"'{needle}' {'found' if passed else 'NOT found'} in written files"
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
    system = f"{base} Answer only 'yes' or 'no' — no other text."
    user = _load_user_template().format(question=question, code=code[:6000])

    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "temperature": 0.0,
        "max_tokens": 10,
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
        answer = data["choices"][0]["message"]["content"].strip().lower()
        passed = answer.startswith("yes")
        return passed, f"Judge ({model}): '{answer}'"
    except Exception as e:
        return False, f"Judge ({model}) error: {e}"


# ── Summary helpers ───────────────────────────────────────────────────────────

def pass_rate(results: list[GraderResult]) -> float:
    if not results:
        return 1.0
    return sum(1 for r in results if r.passed) / len(results)


def print_grader_results(results: list[GraderResult]) -> None:
    print(f"\n{'─'*60}")
    print(f"  Code Graders  ({sum(r.passed for r in results)}/{len(results)} passing)")
    print(f"{'─'*60}")
    for r in results:
        mark = "✓" if r.passed else "✗"
        colour = "" # terminal colour optional
        print(f"  {mark} [{r.kind:<8}] {r.name}")
        if not r.passed:
            print(f"           → {r.detail}")
    rate = pass_rate(results)
    print(f"{'─'*60}")
    print(f"  Pass rate: {rate*100:.0f}%")
