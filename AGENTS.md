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

L5 (version_correctness) only runs when MCP is enabled — the model has docs access, so using deprecated APIs is a real failure.

The delta between configurations shows where Auth0's investment produces measurable value.

Each eval lives in `src/evals/<category>/<eval-dir>/` and consists of a `PROMPT.md` (task description) and a `graders.ts` (acceptance criteria). The framework runs the eval, grades the agent's output, and scores it across 8 dimensions into a JSON results file. Each eval also has a snake_case config ID (e.g. `react_quickstart`) registered in `src/config/evaluations.ts` — this ID is used with `--eval` and is separate from the on-disk directory name (e.g. `src/evals/quickstarts/react`).

Full guide for adding evals: [docs/ADDING_EVALS.md](docs/ADDING_EVALS.md)

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

Use `notContainsInSource` (not `notContains`) when a value like a client ID is allowed in config files but must not appear in source code.

## Grading exclusions

Graders run against **agent-written files only**. The following are excluded from the grading corpus:
- `.claude/skills/` — injected skill files (would contaminate `contains()` checks)
- `package-lock.json` — noise

---

## Linting & formatting

The project uses ESLint and Prettier. Run `npm run lint` and `npm run format` before committing, and follow any errors they surface.

---

## Adding an eval — checklist

1. `src/evals/<category>/<eval-dir>/PROMPT.md` + `graders.ts`
2. Register in `src/config/evaluations.ts` — `id` is the snake_case config ID (e.g. `vue_quickstart`), `path` points to the directory (e.g. `src/evals/quickstarts/vue`); these are **not** the same
3. All imports use `.js` extensions; `import type` for type-only
4. All graders have `GraderLevel`; one final holistic `judge` with no level
5. `npm run build && npm test` passes

---

## Scoring

Process dimensions (50% weight) are **zeroed out when the agent didn't execute** (0 tool calls). This prevents broken runs from scoring high on "efficiency" by doing nothing. Output dimensions (Correctness, Hallucination, Security) always score normally.

## Agent runners

| Runner | Used for | Auth |
|---|---|---|
| ReAct (`auth0-ReAct-agent`) | GPT, Gemini — any model via ATKO LiteLLM proxy | `ATKO_API_KEY` env var |
| Claude Code (`claude-code`) | Claude models — auto-selected | `ATKO_API_KEY` via ATKO proxy |

Claude Code runner spawns the `claude` CLI as a subprocess, routing requests through the ATKO proxy.

By default it uses the Bedrock proxy, which maps short aliases (e.g. `claude-4-6-sonnet`) to full Bedrock model IDs. Set `CLAUDE_CODE_USE_BEDROCK_PROXY=0` to route through the LiteLLM proxy instead — aliases are passed directly and the proxy handles resolution.

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

npm run run -- --eval react_quickstart --mode agent
npm run run -- --eval react_quickstart --mode agent --tools skills
npm run run -- --eval react_quickstart --mode agent --tools mcp,skills
npm run run -- --mode all --model all --workers 8
npm run run -- --eval react_quickstart --mode agent --keep-workspace  # inspect temp workspace
npm run report
```
