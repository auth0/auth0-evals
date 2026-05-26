# auth0-evals

An evaluation framework for measuring how accurately LLM agents complete Auth0 integration tasks. It runs each task across multiple configurations — from a single LLM call with no tools, to a full agentic loop with MCP servers and skills — and compares the results so you can see exactly where each investment pays off.

## Monorepo structure

```
packages/
  eval/            CLI + agent runners (@a0/eval)
  eval-core/       Core types, grader engine, workspace management (@a0/eval-core)
  eval-graders/    Grader primitives: contains, matches, judge (@a0/eval-graders)
  eval-reporter/   HTML report generation (@a0/eval-reporter)

apps/
  auth0-evals/     Auth0-specific eval suite that consumes the framework
```

| Package | Purpose |
|---------|---------|
| [`@a0/eval`](packages/eval/) | CLI (`a0-eval`), agent runners (Claude Code, Copilot, Gemini CLI), scoring, and result persistence |
| [`@a0/eval-core`](packages/eval-core/) | Framework core — config loader, eval discovery, grader engine, workspace lifecycle, type definitions |
| [`@a0/eval-graders`](packages/eval-graders/) | Grader factory functions (`contains`, `notContains`, `matches`, `judge`) and the `GraderLevel` enum |
| [`@a0/eval-reporter`](packages/eval-reporter/) | Generates HTML reports from scored results |
| [`auth0-evals`](apps/auth0-evals/) | The Auth0 eval suite — task prompts, graders, scaffolds, and configuration |

## Quick start

```bash
cp .env.example .env
# add your LLM_API_KEY to .env
# add GH_TOKEN if running evals that use gh CLI calls (e.g. android_quickstart): gh auth token

npm install
npm run build

cp apps/auth0-evals/.env.example apps/auth0-evals/.env
# add your API key to apps/auth0-evals/.env

# Run a single eval in baseline mode
npm run evals -- --eval react_quickstart --mode baseline

# Run the matrix (all evals × all models × baseline + agent+skills + agent+mcp+skills)
npm run evals -- --matrix

# Generate an HTML report
npm run report
```

## How it works

Each eval defines a **prompt** (the task an LLM must complete) and **graders** (pass/fail checks against the generated code). The framework runs the prompt across 5 configurations:

| Configuration | What it tests |
|---|---|
| `baseline` | Single LLM call, no tools — training-data knowledge only |
| `agent` | Full agentic loop with file/shell tools |
| `agent+skills` | Agent + skill files injected into context |
| `agent+mcp` | Agent + MCP server tools |
| `agent+mcp+skills` | Agent + MCP + skills combined |

The delta between configurations tells you where to invest:

- **baseline → agent** — value of tool access alone
- **agent → agent+skills** — value of skills investment
- **agent → agent+mcp** — value of MCP server
- **agent+mcp+skills** — full compound effect

Agent runs are scored across 7 dimensions (process + output quality) into a JSON results file. See [`packages/eval`](packages/eval/) for CLI documentation and scoring details.

## Documentation

- [`packages/eval/README.md`](packages/eval/) — CLI usage, configuration, runners, scoring methodology
- [`apps/auth0-evals/README.md`](apps/auth0-evals/) — Auth0 eval suite, available evals, how to add new ones
- [`docs/ADDING_EVALS.md`](docs/ADDING_EVALS.md) — Full guide to writing evals
- [`docs/SCORING_METHODOLOGY.md`](docs/SCORING_METHODOLOGY.md) — Scoring philosophy and dimension details
- [`docs/TESTING_SKILLS.md`](docs/TESTING_SKILLS.md) — How to test skills locally

## Development

```bash
npm install       # install all workspace dependencies
npm run build     # compile all packages
npm test          # run tests across all packages
npm run lint      # lint
npm run format    # format with Prettier
```

Requires Node.js 24+ and Docker (for sandboxed agent runs).
