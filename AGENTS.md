# AGENTS.md

## What this repo does

`auth0-evals` is an evaluation framework that measures how accurately LLM agents complete Auth0 SDK integration tasks. It runs each task across 5 configurations (2 modes × optional tool flags) and compares results:

| Configuration | CLI flags | What it tests | Grader levels |
|---|---|---|---|
| `baseline` | `--mode baseline` | Single LLM call, no tools — training data knowledge only | L1-L3 |
| `agent` | `--mode agent` | Full agentic loop with file/shell tools | L1-L4 |
| `agent+skills` | `--mode agent --tools skills` | Agent + SKILL.md injected into context | L1-L4 |
| `agent+mcp` | `--mode agent --tools mcp` | Agent + Auth0 MCP server tools | L1-L5 |
| `agent+mcp+skills` | `--mode agent --tools mcp,skills` | Agent + MCP + skills (full investment) | L1-L5 |

Each eval lives in `src/evals/<category>/<eval-dir>/` and consists of a `PROMPT.md` (task description) and a `graders.ts` (acceptance criteria). The framework runs the eval and grades the output. Agent-mode runs are scored across 7 dimensions into a JSON results file; baseline runs only produce grader pass rates (no 7-dimension scoring). Each eval also has a snake_case config ID (e.g. `react_quickstart`) registered in `src/config/evaluations.ts` — this ID is used with `--eval` and is separate from the on-disk directory name (e.g. `src/evals/quickstarts/react`).

Full guide for adding evals: [docs/ADDING_EVALS.md](docs/ADDING_EVALS.md)

---

## Guiding principles

1. **Grade the artifact, not the explanation.** Verify generated code compiles, imports real packages, and calls actual SDK methods. Never grade prose — only code.
2. **Isolate each investment for independent measurement.** Mode and tools are orthogonal. Each tool flag adds exactly one variable so we can measure its impact in isolation.
3. **Every score must point to a fix.** A score of 72 is useless without "the biggest lever is adding X to `llms.txt`." If a score doesn't tell you what to change, it's a vanity metric.
4. **If every model passes, the eval is broken.** Graders must differentiate. When all models score >90%, tighten the graders.
5. **The journey matters as much as the destination.** We score _how_ the agent got there (friction, thrashing, error recovery), not just whether it arrived.

---

## Conventions

### ESM — `.js` extensions on every import

`package.json` sets `"type": "module"`. Every import needs a `.js` extension, even when importing `.ts` source files. Use the `node:` prefix for builtins. Use `import type` for type-only imports.

```typescript
import { contains } from '../agent_eval/graders.js';  // ✓
import { readFileSync } from 'node:fs';               // ✓
import { contains } from '../agent_eval/graders';     // ✗ fails at runtime
```

For dynamic imports of absolute paths, use `pathToFileURL(path).href` — bare absolute paths fail on macOS and Windows.

### Tools return tuples, never throw

Tools return `[message, isDoc, isInterrupt, isError]`. Throwing crashes the agent loop:

```typescript
return ['path argument is required', false, false, true];  // ✓
throw new Error('path required');                          // ✗ crashes the loop
```

Always resolve file paths with `resolveInside(context.workspace, args.path)` — not `join()`. It throws on path traversal attempts.

---

## Grader levels

Every grader must have a `GraderLevel`. End every eval with one holistic `judge` with **no level** — it always runs regardless of level filtering:

| Level | Enum value | What it tests | Runs in |
|---|---|---|---|
| L1 | `positive_presence` | Required SDK symbols, imports, config keys are present | All configs |
| L2 | `hallucination` | Hallucinated packages / wrong SDK variants are absent | All configs |
| L3 | `security` | No hardcoded credentials or tokens in insecure storage | All configs |
| L4 | `structural` | Code is correctly wired — right components, lifecycle handled | Agent configs only |
| L5 | `version_correctness` | Uses current API, not deprecated patterns | Agent+MCP configs only |

For rationale on why each level runs in specific configurations, see `docs/SCORING_METHODOLOGY.md`.

Use `notContainsInSource` (not `notContains`) when a value like a client ID is allowed in config files but must not appear in source code.

### Grader primitives

| Primitive | What it does |
|---|---|
| `contains(needle)` | Substring present in any non-excluded workspace file |
| `notContains(needle)` | Substring must NOT appear in any non-excluded workspace file |
| `notContainsInSource(needle)` | Substring must NOT appear in source files (allowed in config) |
| `matches(pattern)` | Regex match in any non-excluded workspace file |
| `judge(question, framework?)` | LLM-as-judge yes/no question — uses `claude-sonnet-4-5` |

## Grading exclusions

Graders run against all workspace files (scaffold + agent edits) minus the exclusions below. The following directories and files are excluded from the grading corpus:

**Directories:**
- `.claude` — injected skill files and agent context
- `.github` — workflow metadata
- `.gemini` — Gemini agent context
- `node_modules` — dependencies
- `dist` — build output
- `.next` — Next.js build cache
- `.nuxt` — Nuxt build cache
- `.output` — generic build output
- `.build` — generic build output
- `.angular` — Angular build cache
- `out-tsc` — TypeScript compiled output

**Files:**
- `package-lock.json` — noise
- `tsconfig.tsbuildinfo` — TypeScript incremental build cache
- `GEMINI.md` — injected agent context

Additionally, the LLM judge excludes `tsconfig*.json` and `angular.json` from its input to save token budget.

---

## Linting & formatting

The project uses ESLint and Prettier. Run `npm run lint` and `npm run format` before considering work done and before committing. Always run these commands in the current working directory — do not run them in other git worktrees.

---

## Adding an eval — checklist

1. `src/evals/<category>/<eval-dir>/PROMPT.md` + `graders.ts`
2. Register in `src/config/evaluations.ts` — `id` is the snake_case config ID (e.g. `vue_quickstart`), `path` points to the directory (e.g. `src/evals/quickstarts/vue`); these are **not** the same
3. All imports use `.js` extensions; `import type` for type-only
4. All graders have `GraderLevel`; one final holistic `judge` with no level
5. `npm run build && npm test` passes

---

## Scoring methodology

**Workflow for changes**: propose in `docs/SCORING_METHODOLOGY.md` → merge to master → implement code changes → update AGENTS.md to reflect current state.

### Overview

7 dimensions, each scored 0–100, combined by weighted sum into an overall score. Process dimensions (50%) measure *how* the agent worked. Output dimensions (50%) measure *what* it produced. Process dimensions are **zeroed when the agent didn't execute** (0 tool calls) — this prevents broken runs from scoring high on "efficiency" by doing nothing.

### Grade thresholds

| Grade | Min score |
|-------|-----------|
| A | 90 |
| B | 75 |
| C | 60 |
| D | 40 |
| F | < 40 |

### Process dimensions (50%)

#### Setup Friction — 14%

Measures how cleanly the agent completed the task without needing human help or hitting infrastructure errors.

```
score = 100
score -= interruptions × 14
score -= provider_errors × 10
score = max(0, score)
```

- **Interruptions**: tool calls where `isInterruption = true` (the `ask_user` tool). Each costs 14 points. 7+ interruptions = score 0.
- **Provider errors**: LLM API failures (rate limits, timeouts, malformed responses). Each costs 10 points.
- A clean run with no interruptions and no errors scores **100**.

#### Setup Speed — 14%

Measures how quickly the agent completed tool execution, using **active tool time** (sum of individual tool call durations), not wall time.

```
active_time = sum(tool_call.endTime - tool_call.startTime) for all tool calls
excess = max(0, active_time - 60)
score = max(0, 100 - excess × 0.4)
```

- **Ideal**: 60 seconds of active tool time (`SPEED_IDEAL_ACTIVE_S`).
- **Degradation**: 0.4 points per excess second (`SPEED_DEGRADATION_RATE`). At 310s active time, score hits 0.
- Notes include both active and wall time for comparison, plus doc lookup count.

#### Efficiency — 14%

Measures whether the agent solved the task in a focused way or thrashed — reading files it didn't need, retrying failed writes, overwriting its own output.

```
waste_count = count of tool calls matching ≥1 waste category (each call counted at most once)
efficiency (%) = max(0, 100 × (1 - waste_count / total_calls))
```

Waste categories (a single call can match multiple, but is counted at most once):
1. **Duplicate reads** — same path read twice with no intervening `write_file` or `run_command`. A `run_command` resets duplicate-read tracking for all paths (it may mutate any file).
2. **Errored calls** — any call where `causedError = true` OR `isRetry = true`.
3. **Overwritten writes** — a `write_file` to path X followed by another `write_file` to path X with no intervening `read_file` (the first write was discarded).
4. **Interruptions** — `isInterruption = true` calls. Intentionally double-counted with Setup Friction (Friction penalises user disruption; Efficiency penalises the wasted call slot).

- When `total_calls == 0`, the scorer function returns 100 but the process-dimension gate (see Overview) zeroes it — a run with no tool calls scores 0 on all process dimensions.
- Notes include a tool-call summary plus a per-category waste breakdown.

#### Error Recovery — 8%

Measures how many provider errors the agent encountered.

```
score = max(0, 100 - provider_errors × 20)
```

- Each provider error costs 20 points (`ERROR_RECOVERY_PENALTY`). 5+ errors = score 0.
- Notes show up to 3 error messages.

### Output dimensions (50%)

#### Correctness — 25%

Pass rate of graders active for the current configuration, **excluding L2 (hallucination) and L3 (security) graders**. L2 and L3 are excluded because they have their own dedicated scoring dimensions — including them here would double-count their failures.

```
relevant = graders where level ∉ {L2, L3}
score = 100 × passed_relevant / total_relevant
```

- Includes L1, L4, L5 graders (per configuration level filter) plus the holistic judge.
- L2 and L3 graders are scored exclusively in the Hallucination and Security dimensions.
- If no relevant graders run, score is 0.

#### Hallucination — 15%

Pass rate of **L2 graders only**. Catches hallucinated packages, wrong SDK variants, invented API methods.

```
relevant = graders where level == L2
if none: score = 100
else: score = 100 × passed / relevant.length
```

- L2 graders are scored exclusively here — they are excluded from Correctness to prevent double-counting.
- Notes show up to 3 failure details.

#### Security — 10%

Pass rate of **L3 graders only**. Catches hardcoded secrets, tokens in insecure storage, credentials in source code.

```
relevant = graders where level == L3
if none: score = 100
else: score = 100 × passed / relevant.length
```

- L3 graders are scored exclusively here — they are excluded from Correctness to prevent double-counting.
- Notes show up to 3 failure details.

---

## Agent runners

| Runner | ID | Used for | How it's selected |
|---|---|---|---|
| ReAct | `auth0-ReAct-agent` | Default fallback, any model via ATKO LiteLLM proxy | Default when no auto-routing matches, or explicit `--agent-type` |
| Claude Code | `claude-code` | Claude models via Agent SDK | Auto-selected for `claude-*` models when no `--agent-type` flag |
| Copilot SDK | `copilot` | GPT models via `@github/copilot-sdk` | Auto-selected for `gpt-*` models when no `--agent-type` flag |
| Gemini CLI | `gemini-cli` | Gemini models via Gemini CLI | Auto-selected for `gemini-*` models when no `--agent-type` flag |

### Auto-routing logic

When `--agent-type` is **not** specified, the runner is selected by model prefix:
- `claude-*` → `claude-code`
- `gemini-*` → `gemini-cli`
- `gpt-*` → `copilot`
- anything else → `auth0-ReAct-agent` (default)

Explicit `--agent-type` overrides auto-routing for runner selection. Exception: `--agent-type claude-code` with a non-`claude-*` model replaces the model with a deduplicated sentinel (`model='claude-code'`), causing the runner to use its default Claude model instead of attempting the requested one.

### Claude Code runner details

Uses `@anthropic-ai/claude-agent-sdk` `query()` function (not CLI subprocess). Routes through ATKO proxy.

By default uses the Bedrock proxy (`CLAUDE_CODE_USE_BEDROCK_PROXY` != `0`), which maps supported short aliases to full Bedrock model IDs:
- `claude-sonnet-4-6` → `global.anthropic.claude-sonnet-4-6`
- `claude-opus-4-6` → `global.anthropic.claude-opus-4-6-v1`
- `claude-opus-4-7` → `global.anthropic.claude-opus-4-7`
- `claude-sonnet-4-5` → `global.anthropic.claude-sonnet-4-5-20250929-v1:0`
- `claude-opus-4-5` → `global.anthropic.claude-opus-4-5-20251101-v1:0`
- `claude-haiku-4-5` → `global.anthropic.claude-haiku-4-5-20251001-v1:0`

Set `CLAUDE_CODE_USE_BEDROCK_PROXY=0` to route through the LiteLLM proxy instead — aliases are resolved via `LITELLM_MODEL_MAP` (underscore-prefixed, e.g. `_claude-opus-4-7`).

---

## ReAct agent tools

The built-in ReAct agent has 7 base tools available to all agent configurations, plus 2 skill-only tools:

| Tool | Available in | Purpose |
|---|---|---|
| `read_file` | All agent configs | Read file contents from workspace |
| `list_files` | All agent configs | List files under a directory |
| `write_file` | All agent configs | Write/overwrite a file |
| `run_command` | All agent configs | Run shell command in workspace |
| `fetch_url` | All agent configs | Fetch a documentation URL |
| `ask_user` | All agent configs | Ask user for info (credentials, domains) — counts as interruption |
| `finish_task` | All agent configs | Signal task completion |
| `list_skill_files` | `+skills` configs only | List files in an Auth0 SDK skill directory |
| `read_skill_file` | `+skills` configs only | Read a file from an Auth0 SDK skill directory |

When MCP tools are enabled (`--tools mcp`), MCP server tool definitions are appended to the tool list.

---

## Models

### Known working models

Used when `--model all` is passed:

- `gpt-5.4` (default when no `--model` flag)
- `gpt-5.4-mini`
- `claude-sonnet-4-6`
- `claude-opus-4-6`
- `claude-opus-4-7`
- `claude-haiku-4-5`
- `gemini-3.1-pro-preview`
- `gemini-3.1-flash-lite-preview`

### Judge model

All LLM-as-judge graders use `claude-sonnet-4-5` via the ATKO proxy (`https://llm.atko.ai/v1`).

### Settings

| Setting | Value |
|---|---|
| Base URL | `https://llm.atko.ai/v1` |
| Judge model | `claude-sonnet-4-5` |
| Judge max tokens | 1024 |
| Judge max code chars | 16,384 |
| Max agent turns | 30 |
| Claude Code task timeout | ~250 min (~4.2 hours, 50 × 300s) |
| Copilot task timeout | ~250 min (~4.2 hours, 50 × 300s) |

---

## Slash commands

| Command | Purpose |
|---|---|
| `/evals-smoke-test` | End-to-end smoke test: builds the project, runs the full `react_quickstart` matrix across all models and configurations, generates an HTML report, and reports a PASS/FAIL verdict. Use after making framework changes to verify nothing is broken. |

## Key commands

```bash
npm run build     # compile to dist/
npm test          # run Vitest
npm run lint
npm run format

# Single eval
npm run run -- --eval react_quickstart --mode agent
npm run run -- --eval react_quickstart --mode agent --tools skills
npm run run -- --eval react_quickstart --mode agent --tools mcp,skills

# Full matrix (all evals × all models × baseline + agent with tool sets)
npm run run -- --matrix --workers 20

# All modes, all models, limited parallelism
npm run run -- --mode all --model all --workers 8

# Specific agent runner
npm run run -- --eval react_quickstart --mode agent --agent-type claude-code

# Keep workspace for debugging
npm run run -- --eval react_quickstart --mode agent --keep-workspace

# Generate HTML report from results
npm run report
```

### CLI flags

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--eval <id>` | Any registered eval ID | all evals | Repeatable |
| `--model <model>` | Any model string | `gpt-5.4` | Repeatable; `all` expands to known working models |
| `--mode <mode>` | `baseline`, `agent`, `all` | `baseline` | `all` expands to both |
| `--tools <tools>` | `skills`, `mcp`, or comma-separated | none | Only applies to agent mode |
| `--agent-type <type>` | `auth0-ReAct-agent`, `claude-code`, `copilot`, `gemini-cli` | auto-routed by model | Overrides auto-routing |
| `--matrix` | flag | off | All evals × models × baseline + agent with tool sets (skills, mcp+skills); defaults workers to 20 |
| `--workers <n>` | number | 4 (defaults to 20 in matrix) | Parallel job limit |
| `--output <path>` | file path | auto-named | JSON results output |
| `--keep-workspace` | flag | off | Don't delete temp workspace after run |
| `--braintrust` | flag | off | Log results to Braintrust experiment |

---

## Glossary

| Term | Definition |
|---|---|
| **Workspace** | Temporary directory created per eval run. Contains the scaffold plus everything the agent writes. Deleted after the run unless `--keep-workspace`. |
| **Scaffold** | Starter project seeded into the workspace before the agent runs — e.g., a bare `create-react-app` or an empty Express server. The agent builds on top of it. |
| **Grader** | A single pass/fail check run against workspace output. Defined in each eval's `graders.ts`. Has a level (L1–L5) or no level (holistic judge). |
| **Grader primitive** | Factory function that creates a grader: `contains`, `notContains`, `notContainsInSource`, `matches`, `judge`. |
| **Needle** | The substring or pattern a grader searches for — as in "needle in a haystack." The first argument to `contains`, `notContains`, and `notContainsInSource`. |
| **Configuration** | A specific combination of mode + tools — e.g., `agent+mcp+skills`. Determines which grader levels are active. |
| **Mode** | `baseline` (single LLM call, no tools) or `agent` (full agentic loop with file/shell tools). |
| **Runner** | The agent runtime that executes the task: ReAct (built-in), Claude Code, Copilot SDK, or Gemini CLI. |
| **Interruption** | An `ask_user` tool call — the agent asking for human input (credentials, domains). Penalized in Setup Friction scoring. |
| **Provider error** | LLM API failure: rate limit, timeout, malformed response. Penalized in both Setup Friction and Error Recovery. |
| **Holistic judge** | The final `judge()` grader in every eval with no level assigned. Always runs regardless of configuration. Asks the LLM judge a high-level yes/no question about overall correctness. |
