# auth0-evals

Evaluation framework for measuring how well LLM agents complete developer integration tasks.

## Quick Start

```bash
cp .env.example .env
# add your ATKO_API_KEY to .env

npm install

# Run all evals × all models × all modes (recommended)
npm run run -- --mode all --model all --workers 8

# Generate and view report
npm run report
```

### Run with multiple models and modes

```bash
# Quick test - baseline mode with default model
npm run run -- --eval react_quickstart --mode baseline

# Test all modes with one model
npm run run -- --eval react_quickstart --mode all --model gpt-5.2

# Run all known working models in baseline mode
npm run run -- --model all --mode baseline

# Run specific models across all modes
npm run run -- --model claude-4-6-sonnet --model claude-4-6-opus --mode all

# Full evaluation - all modes × all models
npm run run -- --eval react_quickstart --mode all --model all --workers 8

# Run everything (all evals × all models × all modes)
npm run run -- --mode all --model all

# Generate HTML report from results
npm run report -- --input scores-all-modes.json

# Run and view results in one command
npm run run -- --eval react_quickstart --mode all --model all && npm run report -- --input scores-all-modes.json && open report.html
```

## Modes

| Mode | Description |
|------|-------------|
| `baseline` | Single LLM call, no tools, no skills. What the model knows from training data alone. |
| `agent` | Full agentic loop with tools (read/write/bash/fetch). What agents do without our investment. |
| `agent+skills` | Full agentic loop with tools + SKILL.md injected into context. The real-world scenario. |

Use `--mode all` to run all three modes in parallel for faster evaluation.

The delta between modes tells you where to invest:
- **baseline → agent**: value of tool access alone
- **agent → agent+skills**: value of our skills investment
- **baseline → agent+skills**: total end-to-end improvement

## Models

| Model | ID |
|-------|----|
| GPT-5.2 | `gpt-5.2` |
| Claude Sonnet 4.6 | `claude-4-6-sonnet` |
| Claude Opus 4.6 | `claude-4-6-opus` |
| Gemini 3 Pro | `gemini-3-pro-preview` |

```bash
# Run with a specific model
npm run run -- --model gpt-5.2
npm run run -- --model claude-4-6-sonnet
npm run run -- --model claude-4-6-opus
npm run run -- --model gemini-3-pro-preview

# Run with multiple models
npm run run -- --model claude-4-6-sonnet --model claude-4-6-opus

# Run with a specific model and mode
npm run run -- --model gpt-5.2 --mode agent
```

Results are merged into the output file by `(eval_id, model, mode)` key. Re-running a single model updates only its entries — scores for all other models are preserved.

```bash
# Run all models once to build the full baseline
npm run run -- --model all

# Later, re-run only one model without losing the rest
npm run run -- --model gpt-5.2
```

## Options

```
--eval      Eval ID to run (default: all). Can be repeated.
--model     Model to use (default: gpt-5.2). Can be repeated for multiple models.
            Use 'all' to run all known working models.
--mode      baseline | agent | agent+skills | all (default: baseline)
            Use 'all' to run all three modes in parallel.
--workers   Parallel workers (default: 4)
--output    JSON output path (default: scores-<mode>.json or scores-all-modes.json)
--keep-workspace   (agent mode only) Keep temp workspace after run
```

### Known Working Models

The framework maintains a list of models that work reliably across all modes (baseline, agent, and agent+skills):

**OpenAI:**
- `gpt-5.2` (default)

**Anthropic:**
- `claude-4-6-sonnet`
- `claude-4-6-opus`

**Google:**
- `gemini-3-pro-preview`

**Note:** Model availability depends on your ATKO API key configuration.

## Evals

| Category | ID | Description |
|----------|----|-------------|
| `quickstarts` | `react_quickstart` | Add Auth0 authentication to a React app using @auth0/auth0-react |
| `quickstarts` | `nextjs_quickstart` | Add Auth0 authentication to a Next.js App Router app using @auth0/nextjs-auth0 |
| `quickstarts` | `swift_quickstart` | Add Auth0 authentication to a Swift iOS app using Auth0.swift |

## Skills

In `agent+skills` mode, SKILL.md files are fetched from the [auth0/agent-skills](https://github.com/auth0/agent-skills) repository and injected into the agent's system prompt alongside full tool access.

Each eval declares which skill it needs in its `PROMPT.md` frontmatter:

```yaml
---
skills: auth0-react
---
```

The runner fetches the corresponding `SKILL.md` from [auth0/agent-skills](https://github.com/auth0/agent-skills) on GitHub at runtime:

```
https://raw.githubusercontent.com/auth0/agent-skills/main/plugins/auth0-sdks/skills/<name>/SKILL.md
```

Fetched skills are cached in memory across parallel workers to avoid redundant HTTP calls. If an eval has no `skills:` declared, agent+skills mode runs identically to agent mode.

Multiple skills can be declared comma-separated:

```yaml
skills: auth0-react, auth0-nextjs
```

## Structure

```
run.ts                          # CLI entry point
report.ts                       # HTML report generator
config/
  evaluations.ts                # central eval registry
  settings.ts                   # API base URL, judge model, limits
  costs.ts                      # per-model token cost table
runners/
  loader.ts                     # parses PROMPT.md, imports graders.ts
  baseline.ts                   # pure LLM, no tools
  skills.ts                     # fetches + injects SKILL.md into eval prompts (agent+skills mode)
agent_eval/
  agent.ts                      # ReAct agent runner with tool execution
  graders.ts                    # contains() / matches() / judge() primitives
  scorer.ts                     # 8-dimension scoring
evals/
  <category>/
    <eval-id>/
      PROMPT.md                 # task description + optional skills declaration
      graders.ts                # defineGraders() — acceptance criteria
      scaffold/                 # optional starter files for agent workspace
templates/
  report.html.j2                # Nunjucks HTML report template
prompts/
  judge/                        # LLM-as-judge system prompts per framework
tests/                          # Vitest test suite
```

## Adding an Eval

1. Create `evals/<category>/<eval-id>/PROMPT.md`
2. Create `evals/<category>/<eval-id>/graders.ts` with a `defineGraders()` function
3. Optionally declare a skill in `PROMPT.md` frontmatter (`skills: auth0-react`)
4. Optionally add starter files in `evals/<category>/<eval-id>/scaffold/`
5. Register it in `config/evaluations.ts`
6. Add it as a Vite entry in `vite.config.ts`

```typescript
// config/evaluations.ts
export const EVALUATIONS: EvalConfig[] = [
  {
    id: 'your_eval_id',
    name: 'Your Eval Name',
    category: 'your-category',
    path: 'evals/<category>/your_eval_id',
  },
];
```

```typescript
// evals/<category>/your_eval_id/graders.ts
import { contains, judge } from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    contains('SomeImport'),
    judge('Does the solution correctly integrate X?', 'framework'),
  ];
}
```

```typescript
// vite.config.ts — add to the entry object
'evals/<category>/your_eval_id/graders': resolve(__dirname, 'evals/<category>/your_eval_id/graders.ts'),
```

Then rebuild: `npm run build`

## Development

```bash
npm install       # install dependencies
npm test          # run Vitest test suite
npm run build     # compile to dist/
```

## Requirements

Node.js 24+. Dependencies are managed via `npm`.
