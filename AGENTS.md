# AGENTS.md

## What this repo does

`auth0-evals` is an evaluation framework that measures how accurately LLM agents complete Auth0 SDK integration tasks. It runs each task across 5 configurations (2 modes × optional tool flags) and compares results:

| Configuration      | CLI flags                         | What it tests                                            | Grader levels |
| ------------------ | --------------------------------- | -------------------------------------------------------- | ------------- |
| `baseline`         | `--mode baseline`                 | Single LLM call, no tools — training data knowledge only | L1-L3         |
| `agent`            | `--mode agent`                    | Full agentic loop with file/shell tools                  | L1-L4         |
| `agent+skills`     | `--mode agent --tools skills`     | Agent + SKILL.md injected into context                   | L1-L4         |
| `agent+mcp`        | `--mode agent --tools mcp`        | Agent + Auth0 MCP server tools                           | L1-L5         |
| `agent+mcp+skills` | `--mode agent --tools mcp,skills` | Agent + MCP + skills (full investment)                   | L1-L5         |

Each eval lives in `src/evals/<category>/<eval-dir>/` and consists of a `PROMPT.md` (task description) and a `graders.ts` (acceptance criteria). The framework auto-discovers evals by scanning `evalsDir` for directories containing both files. The eval's snake_case config ID (e.g. `react_quickstart`) is declared in `PROMPT.md` frontmatter via the `id` field — this ID is used with `--eval`. Agent-mode runs are scored across 8 dimensions into a JSON results file; baseline runs only produce grader pass rates (no 8-dimension scoring).

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
import { contains } from '@a0/eval-graders'; // ✓
import { readFileSync } from 'node:fs'; // ✓
import type { GraderDef } from '@a0/eval-graders'; // ✓ type-only
```

For dynamic imports of absolute paths, use `pathToFileURL(path).href` — bare absolute paths fail on macOS and Windows.

### Tools return tuples, never throw

Tools return `[message, isDoc, isInterrupt, isError]`. Throwing crashes the agent loop:

```typescript
return ['path argument is required', false, false, true]; // ✓
throw new Error('path required'); // ✗ crashes the loop
```

Always resolve file paths with `resolveInside(context.workspace, args.path)` — not `join()`. It throws on path traversal attempts.

---

## Grader levels

Every grader must have a `GraderLevel`. End every eval with one holistic `judge` with **no level** — it always runs regardless of level filtering:

| Level | Enum value            | What it tests                                                 | Runs in                |
| ----- | --------------------- | ------------------------------------------------------------- | ---------------------- |
| L1    | `positive_presence`   | Required SDK symbols, imports, config keys are present        | All configs            |
| L2    | `hallucination`       | Hallucinated packages / wrong SDK variants are absent         | All configs            |
| L3    | `security`            | No hardcoded credentials or tokens in insecure storage        | All configs            |
| L4    | `structural`          | Code is correctly wired — right components, lifecycle handled | Agent configs only     |
| L5    | `version_correctness` | Uses current API, not deprecated patterns                     | Agent+MCP configs only |

For rationale on why each level runs in specific configurations, see `docs/SCORING_METHODOLOGY.md`.

Use `notContainsInSource` (not `notContains`) when a value like a client ID is allowed in config files but must not appear in source code.

### Grader primitives

| Primitive                                        | What it does                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contains(needle)`                               | Substring present in any non-excluded workspace file                                                                                                                                                                                           |
| `notContains(needle)`                            | Substring must NOT appear in any non-excluded workspace file                                                                                                                                                                                   |
| `notContainsInSource(needle)`                    | Substring must NOT appear in source files (allowed in config)                                                                                                                                                                                  |
| `matches(pattern)`                               | Regex match in any non-excluded workspace file                                                                                                                                                                                                 |
| `judge(question, framework?)`                    | LLM-as-judge yes/no question — uses `claude-opus-4-8`                                                                                                                                                                                          |
| `ranCommand(command, args, description, level)`  | Agent ran a shell command containing `command` (and all `args`) — event-based, level required (L4 or L5)                                                                                                                                       |
| `ranCommandOneOf(commands, description, level)`  | Agent ran at least one command from the list — event-based, level required (L4 or L5)                                                                                                                                                          |
| `wroteFile(path, description, level, expected?)` | Agent wrote a file whose path contains the substring. With optional `expected` (string or string array), the combined content of all writes to that path must also contain every `expected` substring — event-based, level required (L4 or L5) |
| `compiles(description, level)` | Framework runs the eval's `compile_command` against the workspace after the agent finishes and passes/fails on its exit code — level required (L4 or L5). Decoupled from whether the agent ran the build itself, so output that compiles passes even if the agent never ran the build. Requires `compile_command` in PROMPT.md frontmatter or the grader fails. |
| `calledTool(toolName, description, level)` | Agent invoked an MCP tool whose name contains `toolName` (case-insensitive substring against `mcp__<server>__<tool>` calls; errored calls excluded) — event-based, level required (L4 or L5) |
| `calledToolOneOf(toolNames, description, level)` | Agent invoked at least one of the named MCP tools — event-based, level required (L4 or L5) |

## Grading exclusions

Graders run against all workspace files (scaffold + agent edits) minus the exclusions below. The following directories and files are excluded from the grading corpus:

**Directories:**

- `.claude` — injected skill files and agent context
- `.codex` — Codex agent context
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
- `CLAUDE.md`, `GEMINI.md`, `AGENTS.md` — injected agent guidance. Before each agent run, the framework writes the "no documentation files" guidance into the context file the chosen runner reads (`CLAUDE.md` for Claude Code, `GEMINI.md` for Gemini CLI, `AGENTS.md` for Codex, and `.github/copilot-instructions.md` for Copilot — the `.github` dir is already excluded). All three are excluded so the injected text is never graded.

Additionally, the LLM judge excludes `tsconfig*.json` and `angular.json` files, plus the `.gradle` and `app/build` directories (large Android build artifacts), from its input to save token budget. It also excludes `.env*` files so credential values are never sent to the judge. Secret-in-source checks are handled deterministically by `notContainsInSource`; "credentials wired into `.env`" is verified via the event-based `wroteFile` grader — so the judge never needs `.env` contents.

---

## Linting & formatting

The project uses ESLint and Prettier. Run `npm run lint` and `npm run format` before considering work done and before committing. Always run these commands in the current working directory — do not run them in other git worktrees.

---

## Testing

Every new function and every logic change must be accompanied by tests. Each package has its own `tests/` directory (`packages/eval-core/tests/`, `packages/eval/tests/`, `packages/eval-graders/tests/`, etc.) and uses Vitest. Add tests in the package where the changed code lives. Rules:

- **New function** → add at least one happy-path test and one failure/edge-case test.
- **Logic change** → add or update tests that would have caught the regression. If the change is non-trivial (e.g. new branching, new error handling), cover each new branch.
- **Bug fix** → add a test that reproduces the bug before the fix and passes after.

Run `npm test` before committing. A change is not done until tests pass.

---

## Documentation — what to update and when

When you make a change, update every doc whose described behavior is affected. The table below maps change types to the docs that must stay in sync.

| Change type                                                                          | Docs to update                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| New eval added (`PROMPT.md` + `graders.ts`)                                          | `AGENTS.md` eval list (if maintaining one); `docs/ADDING_EVALS.md` if the change reveals a gap in the guide                                     |
| `setup_command` behaviour changed (e.g. new syntax supported)                        | `docs/ADDING_EVALS.md` — frontmatter table and example; `AGENTS.md` checklist if relevant                                                       |
| `compile_command` added to an eval or its context-injection behaviour changed        | `docs/ADDING_EVALS.md` — frontmatter table and example; `AGENTS.md` checklist if relevant                                                       |
| New skill added or skill resolution logic changed                                    | `docs/TESTING_SKILLS.md`; `AGENTS.md` if skill tooling or config changed                                                                        |
| New CLI flag or runner added                                                         | `AGENTS.md` CLI flags table and Agent runners table; `README.md` quick-start if the flag is commonly used                                       |
| Scoring dimension added, changed, or removed                                         | `docs/SCORING_METHODOLOGY.md` first (per the workflow); then `AGENTS.md` scoring section once merged                                            |
| New grader level or grader primitive added                                           | `AGENTS.md` grader levels table and grader primitives table; `docs/ADDING_EVALS.md`                                                             |
| Framework package added or restructured                                              | `README.md` Packages list; `packages/eval/README.md` if it exists                                                                               |
| Docker/sandbox behaviour changed                                                     | `AGENTS.md` if it affects how evals run; no dedicated doc today — add a note here                                                               |
| Package structure, runners, scoring, configurations, or end-to-end data flow changed | `docs/ARCHITECTURE.md` — update the prose **and** the Mermaid diagrams (component diagram + data-flow diagram) so they don't drift from reality |

**Rule of thumb**: if a developer reading the doc would get the wrong mental model or follow a broken example after your change, update the doc. If the doc is still accurate, leave it alone. This applies to diagrams too — a Mermaid diagram in `docs/ARCHITECTURE.md` that no longer matches the code is as broken as stale prose; keep both in sync.

---

## Adding an eval — checklist

1. `src/evals/<category>/<eval-dir>/PROMPT.md` + `graders.ts`
2. Add `id` (required) and optionally `name`/`category`/`compile_command` to `PROMPT.md` frontmatter — the framework auto-discovers evals from `evalsDir`. Set `compile_command` to point the agent at a verify-compiles command (injected into the agent's context file, e.g. `CLAUDE.md`); omit for evals with no CLI compile step (e.g. mobile).
3. All imports use `.js` extensions; `import type` for type-only
4. All graders have `GraderLevel`; one final holistic `judge` with no level
5. `npm run build && npm test` passes

---

## Scoring methodology

**Workflow for changes**: propose in `docs/SCORING_METHODOLOGY.md` → merge to master → implement code changes → update AGENTS.md to reflect current state.

### Overview

8 dimensions, each scored 0–100, combined by weighted sum into an overall score. Process dimensions (50%) measure _how_ the agent worked. Output dimensions (50%) measure _what_ it produced. Process dimensions are **zeroed when the agent didn't execute** (0 tool calls) — this prevents broken runs from scoring high on "efficiency" by doing nothing.

### Grade thresholds

| Grade | Min score |
| ----- | --------- |
| A     | 90        |
| B     | 75        |
| C     | 60        |
| D     | 40        |
| F     | < 40      |

### Process dimensions (50%)

#### Setup Friction — 12%

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

#### Setup Speed — 12%

Measures how quickly the agent completed tool execution, using **active tool time** (sum of individual tool call durations), not wall time.

```
active_time = sum(tool_call.endTime - tool_call.startTime) for all tool calls
excess = max(0, active_time - 60)
score = max(0, 100 - excess × 0.4)
```

- **Ideal**: 60 seconds of active tool time (`SPEED_IDEAL_ACTIVE_S`).
- **Degradation**: 0.4 points per excess second (`SPEED_DEGRADATION_RATE`). At 310s active time, score hits 0.
- Notes include both active and wall time for comparison, plus doc lookup count.

#### Efficiency — 12%

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

#### Error Recovery — 7%

Measures how many provider errors the agent encountered.

```
score = max(0, 100 - provider_errors × 20)
```

- Each provider error costs 20 points (`ERROR_RECOVERY_PENALTY`). 5+ errors = score 0.
- Notes show up to 3 error messages.

#### Docs Quality — 7%

Measures how effectively the agent used documentation when it chose to fetch it. Agents that never fetch docs score 100 — succeeding from training data is valid and should not be penalized.

```
if doc_lookups == 0:
    score = 100
else:
    score = sum(points per lookup) / total_lookups
```

Each lookup scores up to 100 points across three signals:

| Signal                             | Points | How detected                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL is a valid Auth0 domain        | +34    | URL `startsWith` one of the allowed prefixes (`https://auth0.github.io`, `https://auth0.com/docs`, `https://auth0.com/blog`, `https://community.auth0.com`, `https://npmjs.com/package/@auth0`, `https://github.com/auth0/`, `https://github.com/auth0-samples`, `https://jwt.io`) |
| Fetch did not error or 404         | +33    | `causedError == false` on the tool call                                                                                                                                                                                                                                            |
| No file overwrite after this fetch | +33    | No `write_file` to an already-written path between this fetch and the next (or end-of-trace for the final fetch) — agent got it right first time                                                                                                                                   |

- All signals are pure trace sequence analysis — no LLM judge, no added cost.
- Notes show per-lookup breakdown and total score.

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

| Runner      | ID            | Used for                             | How it's selected                                               |
| ----------- | ------------- | ------------------------------------ | --------------------------------------------------------------- |
| Claude Code | `claude-code` | Claude models via Agent SDK          | Auto-selected for `claude-*` models when no `--agent-type` flag |
| Copilot SDK | `copilot`     | GPT models via `@github/copilot-sdk` | Not auto-selected; available via `--agent-type copilot`         |
| Gemini CLI  | `gemini-cli`  | Gemini models via Gemini CLI         | Auto-selected for `gemini-*` models when no `--agent-type` flag |
| Codex CLI   | `codex`       | GPT models via OpenAI Codex CLI      | Auto-selected for `gpt-*` models when no `--agent-type` flag    |

### Auto-routing logic

When `--agent-type` is **not** specified, the runner is selected by model prefix:

- `claude-*` → `claude-code`
- `gemini-*` → `gemini-cli`
- `gpt-*` → `codex`
- anything else → `copilot` (default)

Explicit `--agent-type` overrides auto-routing for runner selection. Exception: `--agent-type claude-code` with a non-`claude-*` model replaces the model with a deduplicated sentinel (`model='claude-code'`), causing the runner to use its default Claude model instead of attempting the requested one.

### Claude Code runner details

Uses `@anthropic-ai/claude-agent-sdk` `query()` function (not CLI subprocess). Routes through the configured LLM proxy (`proxy.baseUrl` in `eval.config.js`).

Short aliases are resolved to the ID the active proxy expects via the single `modelIds` map in `eval.config.js`. The map is constructed from the `CLAUDE_CODE_USE_BEDROCK_PROXY` env var at config load time.

By default (LiteLLM proxy) the `modelIds` map is empty — the proxy serves models under the alias itself, so aliases pass through unchanged.

Set `CLAUDE_CODE_USE_BEDROCK_PROXY=1` to route through the Bedrock proxy instead (`/anthropic` endpoint). The config then populates `modelIds` to map supported short aliases to full Bedrock model IDs:

- `claude-sonnet-5` → `global.anthropic.claude-sonnet-5`
- `claude-opus-4-8` → `global.anthropic.claude-opus-4-8`
- `claude-opus-4-5` → `global.anthropic.claude-opus-4-5-20251101-v1:0`
- `claude-haiku-4-5` → `global.anthropic.claude-haiku-4-5-20251001-v1:0`

### Copilot SDK runner details

Uses `@github/copilot-sdk` to drive the bundled Copilot runtime over JSON-RPC. Inference is routed through the configured LLM proxy via an OpenAI-compatible BYOK provider (`provider: { type: 'openai', wireApi: 'responses', baseUrl, apiKey }`) — **not** GitHub's Copilot backend. The Responses API is required because Copilot emits freeform/custom tool calls (e.g. `apply_patch`) that the chat-completions API rejects — the same reason the Codex runner uses `wire_api = "responses"`. This mirrors the Codex runner: the proxy base URL resolves from `agents.copilot.proxy.baseUrl` (falling back to the top-level `proxy.baseUrl`) and is normalized to end in `/v1`; the API key comes from the `LLM_API_KEY` env var. Set `COPILOT_PROXY_BASE_URL` to override the proxy for this runner only.

The runner is GPT-only: `gpt-*` / `o*` models pass through, anything else (e.g. `claude-*`, `gemini-*`, or the `copilot` sentinel) falls back to the default GPT model (`gpt-5.6-sol`).

---

## Agent tools

All agent runners have access to file/shell tools in their respective environments. When using the Copilot runner, the equivalent capabilities are provided natively by the `@github/copilot-sdk` agent loop.

When MCP tools are enabled (`--tools mcp`), MCP server tool definitions are appended to the tool list.

---

## Models

### Known working models

`--model all` expands to this app's `models.known` in `eval.config.js` (falling back to the framework's `KNOWN_WORKING_MODELS` constant only if the app leaves `models.known` empty):

- `gpt-5.6-sol` (default when no `--model` flag)
- `gpt-5.6-luna`
- `gpt-5.6-terra`
- `claude-sonnet-5`
- `claude-opus-4-8`
- `claude-haiku-4-5`
- `gemini-3.1-pro-preview`
- `gemini-3.5-flash`

Opus 4.5 is still supported by the framework (present in the effort-capable set and Bedrock alias map) and can be run explicitly via `--model claude-opus-4-5`; it is intentionally omitted from `--model all` here so batch runs use only Opus 4.8 among the Opus variants. Opus 4.6 and 4.7 have been removed from the registry (deprecated).

### Judge model

All LLM-as-judge graders use `claude-opus-4-8` via the configured LLM proxy (`proxy.baseUrl` in `eval.config.js`).

### Settings

| Setting              | Value                                            |
| -------------------- | ------------------------------------------------ |
| Base URL             | Configured in `eval.config.js` (`proxy.baseUrl`) |
| Judge model          | `claude-opus-4-8`                                |
| Judge max tokens     | 1024                                             |
| Judge max code chars | 32,768                                           |
| Max agent turns      | 75                                               |
| Runner task timeout  | 30 min (per eval, graceful abort)                |
| Docker host timeout  | 35 min (per container, hard kill — sandbox only) |

---

## Slash commands

| Command             | Purpose                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/evals-smoke-test` | End-to-end smoke test: builds the project, runs the full `react_quickstart` matrix across all models and configurations, generates an HTML report, and reports a PASS/FAIL verdict. Use after making framework changes to verify nothing is broken. |

## Key commands

```bash
npm run build     # compile to dist/
npm test          # run Vitest
npm run lint
npm run format

# Single eval
npm run evals -- --eval react_quickstart --mode agent
npm run evals -- --eval react_quickstart --mode agent --tools skills
npm run evals -- --eval react_quickstart --mode agent --tools mcp,skills

# All modes, all models, limited parallelism
npm run evals -- --mode all --model all --workers 8

# Specific agent runner
npm run evals -- --eval react_quickstart --mode agent --agent-type claude-code

# Keep workspace for debugging
npm run evals -- --eval react_quickstart --mode agent --keep-workspace

# Generate HTML report from results
npm run report
```

### CLI flags

| Flag                         | Values                                          | Default              | Notes                                                    |
| ---------------------------- | ----------------------------------------------- | -------------------- | -------------------------------------------------------- |
| `--eval <id>`                | Any registered eval ID                          | all evals            | Repeatable                                               |
| `--model <model>`            | Any model string                                | `gpt-5.6-sol`        | Repeatable; `all` expands to the config's `models.known` |
| `--mode <mode>`              | `baseline`, `agent`, `all`                      | `baseline`           | `all` expands to both                                    |
| `--tools <tools>`            | `skills`, `mcp`, or comma-separated             | none                 | Only applies to agent mode                               |
| `--agent-type <type>`        | `claude-code`, `copilot`, `gemini-cli`, `codex` | auto-routed by model | Overrides auto-routing                                   |
| `--workers <n>`              | number                                          | 4                    | Parallel job limit                                       |
| `--output <path>`            | file path                                       | auto-named           | JSON results output                                      |
| `--keep-workspace`           | flag                                            | off                  | Don't delete temp workspace after run                    |
| `--dangerously-skip-sandbox` | flag                                            | off                  | Disable Docker sandbox — run agent jobs directly on host |
| `--braintrust`               | flag                                            | off                  | Log results to Braintrust experiment                     |

---

## Glossary

| Term                 | Definition                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workspace**        | Temporary directory created per eval run. Contains the scaffold plus everything the agent writes. Deleted after the run unless `--keep-workspace`.                                   |
| **Scaffold**         | Starter project seeded into the workspace before the agent runs — e.g., a bare `create-react-app` or an empty Express server. The agent builds on top of it.                         |
| **Grader**           | A single pass/fail check run against workspace output. Defined in each eval's `graders.ts`. Has a level (L1–L5) or no level (holistic judge).                                        |
| **Grader primitive** | Factory function that creates a grader: `contains`, `notContains`, `notContainsInSource`, `matches`, `judge`, `compiles`.                                                            |
| **Needle**           | The substring or pattern a grader searches for — as in "needle in a haystack." The first argument to `contains`, `notContains`, and `notContainsInSource`.                           |
| **Configuration**    | A specific combination of mode + tools — e.g., `agent+mcp+skills`. Determines which grader levels are active.                                                                        |
| **Mode**             | `baseline` (single LLM call, no tools) or `agent` (full agentic loop with file/shell tools).                                                                                         |
| **Runner**           | The agent runtime that executes the task: Claude Code, Copilot SDK, or Gemini CLI.                                                                                                   |
| **Interruption**     | An `ask_user` tool call — the agent asking for human input (credentials, domains). Penalized in Setup Friction scoring.                                                              |
| **Provider error**   | LLM API failure: rate limit, timeout, malformed response. Penalized in both Setup Friction and Error Recovery.                                                                       |
| **Holistic judge**   | The final `judge()` grader in every eval with no level assigned. Always runs regardless of configuration. Asks the LLM judge a high-level yes/no question about overall correctness. |
