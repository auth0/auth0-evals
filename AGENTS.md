# AGENTS.md

## What this repo does

`auth0-evals` measures how accurately LLM agents complete Auth0 SDK integration tasks across 5 configurations:

| Configuration      | CLI flags                         | Grader levels |
| ------------------ | --------------------------------- | ------------- |
| `baseline`         | `--mode baseline`                 | L1-L3         |
| `agent`            | `--mode agent`                    | L1-L4         |
| `agent+skills`     | `--mode agent --tools skills`     | L1-L4         |
| `agent+mcp`        | `--mode agent --tools mcp`        | L1-L5         |
| `agent+mcp+skills` | `--mode agent --tools mcp,skills` | L1-L5         |

Each eval: `src/evals/<category>/<eval-dir>/PROMPT.md` + `graders.ts`. The `id` field in `PROMPT.md` frontmatter is used with `--eval`.

---

## Key commands

```bash
npm run build     # compile to dist/
npm test          # run Vitest
npm run lint
npm run format

# Run evals
npm run evals -- --eval react_quickstart --mode agent
npm run evals -- --eval react_quickstart --mode agent --tools mcp,skills
npm run evals -- --mode all --model all --workers 8
npm run evals -- --eval react_quickstart --mode agent --keep-workspace

# Generate HTML report
npm run report

# AXIS — run all evals across all agents
npm run axis
npm run axis -- --eval react_quickstart --agent claude-code --model claude-sonnet-5
```

Full CLI flags and AXIS flags: see [`packages/evals/README.md`](packages/evals/README.md).

### AXIS flags (`npm run axis`)

| Flag | Values | Default | Notes |
| ---- | ------ | ------- | ----- |
| `--eval <id>` | Any registered eval ID | all evals | Repeatable |
| `--agent <name>` | `claude-code`, `codex`, `gemini` | all agents | Repeatable |
| `--workers <n>` | number | AXIS default | Parallel job limit |
| `--model <model>` | Any model string | per-agent default | Override model for all configured agents |
| `--output <path>` | file path | `scores-axis.json` in app root | Where to write the scores file |
| `--debug` | flag | off | Capture raw adapter stdout as `.raw.ndjson` for debugging |

---

## Conventions

### ESM — `.js` extensions on every import

`package.json` sets `"type": "module"`. Every import needs a `.js` extension, even when importing `.ts` source files. Use `node:` prefix for builtins. Use `import type` for type-only imports.

```typescript
import { contains } from '@a0/evals-graders'; // ✓
import { readFileSync } from 'node:fs'; // ✓
import type { GraderDef } from '@a0/evals-graders'; // ✓
```

For dynamic imports of absolute paths, use `pathToFileURL(path).href` — bare absolute paths fail on macOS and Windows.

### Tools return tuples, never throw

```typescript
return ['path argument is required', false, false, true]; // ✓
throw new Error('path required'); // ✗ crashes the agent loop
```

Always resolve paths with `resolveInside(context.workspace, args.path)` — not `join()`.

---

## Grader levels

Two authoring rules: **grade the artifact, not the explanation** (verify generated code compiles and calls real SDK methods — never grade prose); **if every model passes, the eval is broken** (tighten graders when all models score >90%).

Every grader must have a `GraderLevel`. End every eval with one holistic `judge` with no level:

| Level | Enum value            | What it tests                                          | Runs in                |
| ----- | --------------------- | ------------------------------------------------------ | ---------------------- |
| L1    | `positive_presence`   | Required SDK symbols, imports, config keys are present | All configs            |
| L2    | `hallucination`       | Hallucinated packages / wrong SDK variants are absent  | All configs            |
| L3    | `security`            | No hardcoded credentials or tokens in insecure storage | All configs            |
| L4    | `structural`          | Code is correctly wired — right components, lifecycle  | Agent configs only     |
| L5    | `version_correctness` | Uses current API, not deprecated patterns              | Agent+MCP configs only |

Use `notContainsInSource` (not `notContains`) when a value is allowed in config files but must not appear in source code.

### Grader primitives

| Primitive                                        | What it does                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `contains(needle)`                               | Substring present in any workspace file. Add `{ source: 'response' }` or `{ source: 'both' }` to also search the agent's final reply text.    |
| `notContains(needle)`                            | Substring must NOT appear in any workspace file. Same `source` option as `contains`.                                                           |
| `notContainsInSource(needle)`                    | Substring must NOT appear in source files (allowed in config).                                                                                 |
| `matches(pattern)`                               | Regex match in any workspace file. Same `source` option as `contains`.                                                                         |
| `judge(question, level?, options?)`              | LLM-as-judge yes/no — uses `claude-opus-5`. Must be phrased as a question whose correct answer is "yes"; throws if the prompt has no `?`, because `yes` = pass and `no` = fail makes an assertion's "no" ambiguous. Options: `{ includeCommandTrace: true }` for CLI-only evals; `{ source: 'response' \| 'both' }` for MCP evals. |
| `ranCommand(command, args, description, level)`  | Agent ran a shell command containing `command` and all `args` — L4 or L5 required.                                                            |
| `ranCommandOneOf(commands, description, level, args?)` | Agent ran at least one command matching an entry in the list, and containing every `args` substring. An entry may itself be an array, requiring all its substrings in the same command — L4 or L5 required. |
| `ranCommandsInOrder(steps, description, level)`  | Agent ran commands in sequence — L4 or L5 required.                                                                                           |
| `wroteFile(path, description, level, expected?)` | Agent wrote a file whose path contains the substring. Optional `expected` checks content — L4 or L5 required.                                 |
| `compiles(description, level)`                   | Framework runs `compile_command` after the agent finishes — L4 or L5 required. Requires `compile_command` in PROMPT.md frontmatter.           |
| `calledTool(toolName, description, level)`       | Agent invoked an MCP tool whose name contains `toolName` — L4 or L5 required.                                                                 |
| `calledToolOneOf(toolNames, description, level)` | Agent invoked at least one of the named MCP tools — L4 or L5 required.                                                                        |

For MCP-only evals (agent replies with text, no files written): use `source: 'response'` on graders. See `docs/ADDING_EVALS.md` for examples.

> **Corpus scope:** `contains`, `notContains`, and `matches` search source files only. `.claude`, `node_modules`, `dist`, and `CLAUDE.md` are excluded from the grading corpus (see `engine.ts`).

---

## Linting & formatting

Run `npm run lint` and `npm run format` before committing. Always run in the current working directory — not in other git worktrees.

---

## Testing

Every new function and logic change needs tests. Packages use Vitest under `tests/` in each package directory.

- New function → happy-path + failure/edge-case test
- Logic change → test that would have caught the regression
- Bug fix → test that reproduces the bug before the fix

Run `npm test` before committing.

---

## Adding an eval — checklist

1. Create `src/evals/<category>/<eval-dir>/PROMPT.md` + `graders.ts`
2. Add `id` (required) and optionally `name`/`category`/`compile_command` to `PROMPT.md` frontmatter
3. All imports use `.js` extensions; `import type` for type-only
4. All graders have `GraderLevel`; one final holistic `judge` with no level
5. `npm run build && npm test` passes

Full guide: [docs/ADDING_EVALS.md](docs/ADDING_EVALS.md)

---

## Documentation

When you change behavior, update the affected doc. Key docs: `docs/ADDING_EVALS.md` (eval authoring), `docs/SCORING_METHODOLOGY.md` (scoring changes first), `docs/ARCHITECTURE.md` (structure/data flow — update prose and Mermaid diagrams), `docs/TESTING_SKILLS.md` (skills), `docs/PROTECTED_MCP.md` (protected MCP server setup and token forwarding).
