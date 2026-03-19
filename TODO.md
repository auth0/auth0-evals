# TODO

## MVP Spec Gaps

### Eval Matrix (13/15 missing)

- [ ] **Next.js (App Router) — Quickstart** — Create `evals/quickstarts/nextjs/` with `PROMPT.md` and `graders.py`.
- [ ] **Next.js (App Router) — API Route Protection** — Create `evals/api_route_protection/nextjs/` with `PROMPT.md` and `graders.py`.
- [ ] **Next.js (App Router) — MFA Step-up** — Create `evals/mfa_stepup/nextjs/` with `PROMPT.md` and `graders.py`.
- [ ] **React SPA — API Route Protection** — Create `evals/api_route_protection/react/` with `PROMPT.md` and `graders.py`.
- [ ] **React SPA — MFA Step-up** — Create `evals/mfa_stepup/react/` with `PROMPT.md` and `graders.py`.
- [ ] **Express — Quickstart** — Create `evals/quickstarts/express/` with `PROMPT.md` and `graders.py`.
- [ ] **Express — API Route Protection** — Create `evals/api_route_protection/express/` with `PROMPT.md` and `graders.py`.
- [ ] **Express — MFA Step-up** — Create `evals/mfa_stepup/express/` with `PROMPT.md` and `graders.py`.
- [ ] **iOS/Swift — Quickstart** — Create `evals/quickstarts/ios/` with `PROMPT.md` and `graders.py`.
- [ ] **iOS/Swift — MFA Step-up** — Create `evals/mfa_stepup/ios/` with `PROMPT.md` and `graders.py`.
- [ ] **Python/FastAPI — Quickstart** — Create `evals/quickstarts/fastapi/` with `PROMPT.md` and `graders.py`.
- [ ] **Python/FastAPI — API Route Protection** — Create `evals/api_route_protection/fastapi/` with `PROMPT.md` and `graders.py`.
- [ ] **Python/FastAPI — MFA Step-up** — Create `evals/mfa_stepup/fastapi/` with `PROMPT.md` and `graders.py`.
- [ ] **Negative grader enforcement** — Each eval must include at least one `not_contains()` or negative `judge()` grader. Neither existing eval (`react_quickstart`, `ios_credentials_manager`) complies.

### Scoring (3/8 dimensions missing)

The scorer implements 5 dimensions with wrong weights. Must be restructured as 50% Process / 50% Output:

- [ ] **Reweight existing dimensions** (`agent_eval/scorer.py`) — Setup Friction → 15%, Efficiency → 10%, Setup Speed → 10%, Error Recovery → 5%.
- [ ] **Add Context/Discoverability dimension (10%)** — Measures ability to find SDKs, CLI, and MCP servers. Currently absent.
- [ ] **Add Correctness dimension (25%)** — Grader pass rate should feed into the weighted score as an Output dimension, not sit separately.
- [ ] **Add Hallucination dimension (15%)** — Score use of non-existent methods, imports, or packages. Requires negative graders or dedicated LLM-as-judge check.
- [ ] **Add Security dimension (10%)** — Check for hardcoded secrets, tokens in localStorage, missing CSRF. Likely driven by `not_contains()` graders.

### Session Trace Narratives

- [ ] **Action type classification** (`agent_eval/agent.py`) — Tag each tool call with a type: `Implementation`, `Discovery`, or `Error`. `ToolCallRecord` has no type field.
- [ ] **Human-readable narrative generator** — Add a formatter that converts `RunRecord.tool_calls` into prose. Example: `"Created src/middleware.ts with auth protection [Implementation, 0.3s]"`. Could live in `agent_eval/traces.py`.

### Grader Primitives

- [ ] **`compile()` grader** — Syntactic validity check. Should run the code through a language-appropriate parser/compiler (e.g. `tsc --noEmit` for TypeScript, `python -m py_compile` for Python).
- [ ] **`e2e()` grader** — Actual user login flow test. Requires a test harness (e.g. Playwright) to validate the generated app works end-to-end.

### Model Registry

- [ ] **Add GPT-5.2** — Register in cost table (`config/`) and verify API compatibility.
- [ ] **Add Claude Opus 4.6** — Currently only `claude-4-5-opus` is registered.
- [ ] **Add Gemini 3 Pro** — Register model ID and cost per token.

### Runner

- [ ] **Artifact extraction for baseline/skills** (`run.py:106-110`) — Non-agent modes pass raw LLM response text to graders. Extract code from Markdown fenced blocks (`` ```js ... ``` ``) before grading.
- [ ] **Single-command full matrix execution** (`run.py`) — Currently requires three separate CLI calls (`--mode baseline`, `--mode skills`, `--mode agent`). Add an `--mode all` option that runs the full eval × model × mode matrix in one command.

---

## Critical (Code Quality)

- [ ] **Path traversal** (`agent_eval/agent.py:208-223`) — `_read_file` / `_write_file` don't validate paths stay within workspace. Use `Path.resolve().relative_to(workspace)`.
- [ ] **URL validation** (`agent_eval/agent.py:239-250`) — `_fetch_url` accepts arbitrary URLs from agent without protocol/domain validation. Add allowlist.
- [ ] **Cost table duplication** (`agent_eval/agent.py:441-447`, `runners/baseline.py:96-102`) — Identical cost tables. Centralize in `config/` and import in both files.
- [ ] **No tests** — Zero test coverage. Add `tests/` directory with pytest. Priority targets: `agent_eval/scorer.py`, `agent_eval/graders.py`, `runners/loader.py`, `run.py`.

## High Priority (Code Quality)

- [ ] **Silent error suppression** (`runners/loader.py:145-148`, `agent_eval/graders.py:45-48`) — Exceptions swallowed with no logging. Add logging at minimum.
- [ ] **Bare `except Exception:`** (`runners/loader.py:147`, `agent_eval/graders.py:47`, `runners/skills.py:89`, `agent_eval/agent.py:205`) — Replace with specific exception types.
- [ ] **Missing type hints** (`run.py:64-70`, `run.py:177`) — Add type annotations to untyped parameters.
- [ ] **Late imports** (`run.py:103-104`, `agent_eval/agent.py:245`) — Move `from pathlib import Path as P` and `import re` to module top-level. Remove unnecessary `Path as P` alias.

## Medium Priority (Code Quality)

- [ ] **Hard-coded config values** (`agent_eval/agent.py:22-23`, `agent_eval/scorer.py:62-99`, `agent_eval/scorer.py:150-156`) — Move `BASE_URL`, `MAX_TURNS`, scoring thresholds, and doc features to `config/`.
- [ ] **Unexplained magic numbers** (`agent_eval/scorer.py:69,94,110`) — Document calibration constants (e.g. `14.0`, `0.4`) with comments explaining the reference run.
- [ ] **Missing docstrings** (`run.py:run_job()`, `report.py:load_scores()`, `report.py:group_results()`) — Add docstrings to all public functions.

## Low Priority (Code Quality)

- [ ] Consider `pyproject.toml` over the minimal `requirements.txt` for better packaging and Python version pinning.
- [ ] Add `__all__` exports to `__init__.py` files for explicit public API definition.
- [ ] Consider output redaction for sensitive data (API keys, tokens) in command output truncation (`agent_eval/agent.py:234-237`).
- [ ] Validate user-provided regex patterns in `agent_eval/graders.py:110-115` to prevent ReDoS.
