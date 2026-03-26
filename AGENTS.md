# AGENTS.md

## What this repo does

`auth0-evals` is an evaluation framework that measures how accurately LLM agents complete Auth0 SDK integration tasks. It runs each task in three modes and compares results:

| Mode | What it tests |
|---|---|
| `baseline` | Single LLM call, no tools — training data knowledge only |
| `agent` | ReAct loop with file/shell tools |
| `agent+skills` | Same as agent, with a `SKILL.md` from [auth0/agent-skills](https://github.com/auth0/agent-skills) injected into the system prompt |

The delta between modes shows where Auth0's investment in skills and documentation produces measurable value.

Each eval lives in `src/evals/<category>/<eval-id>/` and consists of a `PROMPT.md` (task description) and a `graders.ts` (acceptance criteria). The framework runs the eval, grades the agent's output, and scores it across 8 dimensions into a JSON results file.

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

### JSON data in `graders.ts`

Use static imports — Vite inlines them at build time. `readFileSync` with `__dirname` breaks because after compilation `__dirname` resolves to `dist/`, not `src/`:

```typescript
import data from './data.json';                                        // ✓
const data = JSON.parse(readFileSync(join(__dirname, 'data.json')));  // ✗ fails in dist/
```

### Vite entry required per eval grader

Every new eval's `graders.ts` must be registered in `vite.config.ts`. If missing, `loadEval()` silently falls back to raw `.ts` source, which may fail:

```typescript
// vite.config.ts — add to the entry object
'src/evals/quickstarts/my-eval/graders': resolve(__dirname, 'src/evals/quickstarts/my-eval/graders.ts'),
```

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

| Level | Enum value | What it tests |
|---|---|---|
| L1 | `positive_presence` | Required SDK symbols, imports, config keys are present |
| L2 | `hallucination` | Hallucinated packages / wrong SDK variants are absent |
| L3 | `security` | No hardcoded credentials or tokens in insecure storage |
| L4 | `structural` | Code is correctly wired — right components, lifecycle handled |
| L5 | `version_correctness` | Uses current API, not deprecated patterns |

Use `notContainsInSource` (not `notContains`) when a value like a client ID is allowed in config files but must not appear in source code.

---

## Linting & formatting

The project uses ESLint and Prettier. Run `npm run lint` and `npm run format` before committing, and follow any errors they surface.

---

## Adding an eval — checklist

1. `src/evals/<category>/<eval-id>/PROMPT.md` + `graders.ts`
2. Register in `src/config/evaluations.ts`
3. Add grader entry to `vite.config.ts`
4. All imports use `.js` extensions; `import type` for type-only
5. All graders have `GraderLevel`; one final holistic `judge` with no level
6. No `readFileSync` for JSON in graders — use static `import`
7. `npm run build && npm test` passes

---

## Key commands

```bash
npm run build     # compile to dist/
npm test          # run Vitest
npm run lint
npm run format

npm run run -- --eval react_quickstart --mode agent
npm run run -- --mode all --model all --workers 8
npm run run -- --eval react_quickstart --mode agent --keep-workspace  # inspect temp workspace
npm run report
```
