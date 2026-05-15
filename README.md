# auth0-evals

Evaluation framework for measuring how well LLM agents complete developer integration tasks.

## Quick Start

```bash
cp .env.example .env
# add your LLM_API_KEY to .env

npm install

# Run full matrix — all evals × all models × all modes × all tool combos (recommended)
npm run run -- --matrix

# Generate and view report
npm run report
```

### Run with multiple models and modes

```bash
# Quick test - baseline mode with default model
npm run run -- --eval react_quickstart --mode baseline

# Full matrix for a single eval across all models
npm run run -- --matrix --eval react_quickstart

# Run all known working models in baseline mode
npm run run -- --model all --mode baseline

# Run agent mode with skills for a specific eval
npm run run -- --eval react_quickstart --mode agent --tools skills

# Run everything (all evals × all models × full matrix)
npm run run -- --matrix

# Generate HTML report from results
npm run report -- --input scores-matrix.json

# Run and view results in one command
npm run run -- --matrix --eval react_quickstart && npm run report -- --input scores-matrix.json && open report.html
```

## Modes & Tools

| Configuration | CLI flags | What it measures | Grader set |
|------|-----------|-----------------|------------|
| `baseline` | `--mode baseline` | Training data knowledge | L1-L3 |
| `agent` | `--mode agent` | Generic tool access value | L1-L4 |
| `agent+skills` | `--mode agent --tools skills` | Skills investment value | L1-L4 |
| `agent+mcp` | `--mode agent --tools mcp` | MCP server product value | L1-L5 |
| `agent+mcp+skills` | `--mode agent --tools mcp,skills` | Full compound effect | L1-L5 |

Use `--mode all` to run both modes in parallel. Combine with `--tools` for specific tool configurations.

The delta between configurations tells you where to invest:
- **baseline → agent**: value of tool access alone
- **agent → agent+skills**: value of our skills investment
- **agent → agent+mcp**: value of our MCP server
- **agent → agent+mcp+skills**: full compound effect

## Models

| Model | ID |
|-------|----|
| GPT-5.4 | `gpt-5.4` |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` |
| Claude Opus 4.6 | `claude-opus-4-6` |
| Claude Opus 4.7 | `claude-opus-4-7` |
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` |

```bash
# Run with a specific model
npm run run -- --model gpt-5.4
npm run run -- --model claude-sonnet-4-6
npm run run -- --model claude-opus-4-6
npm run run -- --model gemini-3.1-pro-preview

# Run with multiple models
npm run run -- --model claude-sonnet-4-6 --model claude-opus-4-6

# Run with a specific model and mode
npm run run -- --model gpt-5.4 --mode agent
```

Results are merged into the output file by `(eval_id, model, mode)` key. Re-running a single model updates only its entries — scores for all other models are preserved.

```bash
# Run all models once to build the full baseline
npm run run -- --model all

# Later, re-run only one model without losing the rest
npm run run -- --model gpt-5.4
```

## Options

```
--eval      Eval ID to run (default: all). Can be repeated.
--model     Model to use (default: gpt-5.4). Can be repeated for multiple models.
            Use 'all' to run all known working models.
--mode      baseline | agent | all (default: baseline)
            Use 'all' to run both modes in parallel.
--matrix    Run full eval matrix: all evals × all models × all modes × all tool combos.
            Explicit --eval, --model, --mode, or --tools narrow the matrix.
--tools     skills | mcp | mcp,skills (agent mode only)
--workers   Parallel workers (default: 4; default in matrix mode: 20)
--output    JSON output path (default: scores-<mode>.json or scores-all-modes.json)
--keep-workspace   (agent mode only) Keep temp workspace after run
--dangerously-skip-sandbox   Disable Docker sandbox — run agent jobs directly on host
```

### Known Working Models

The framework maintains a list of models that work reliably across all modes:

**OpenAI:**
- `gpt-5.4` (default)

**Anthropic:**
- `claude-sonnet-4-6`
- `claude-opus-4-6`
- `claude-opus-4-7`

**Google:**
- `gemini-3.1-pro-preview`

**Note:** GPT and Gemini use the ATKO LiteLLM proxy (`LLM_API_KEY`). Claude models use the `claude` CLI routed through the ATKO proxy's Bedrock pass-through endpoint by default. Set `CLAUDE_CODE_USE_BEDROCK_PROXY=0` to route through the LiteLLM proxy instead.

## Agent Runners

The `--agent-type` flag selects the agent runner for agent mode:

| Runner | Flag | Default model |
|--------|------|---------------|
| GitHub Copilot (default) | `--agent-type copilot` | `gpt-5.4` |
| Claude Code | `--agent-type claude-code` | auto-selected for `claude-*` models |
| Gemini CLI | `--agent-type gemini-cli` | `gemini-2.5-flash` |

All runners use the shared `LLM_API_KEY` environment variable. Each runner maps it internally to the provider-specific key (e.g. `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`).

## Evals

| Category | ID | Description |
|----------|----|-------------|
| `quickstarts` | `react_quickstart` | Add Auth0 login to a React SPA using @auth0/auth0-react |
| `quickstarts` | `nextjs_quickstart` | Add Auth0 login to a Next.js App Router app using @auth0/nextjs-auth0 |
| `quickstarts` | `swift_quickstart` | Add Auth0 login to a Swift iOS app using Auth0.swift |
| `quickstarts` | `android_quickstart` | Add Auth0 login to an Android app using Auth0.Android |
| `quickstarts` | `express_quickstart` | Add Auth0 login to an Express web app using express-openid-connect |
| `quickstarts` | `express_api_quickstart` | Protect an Express API using express-oauth2-jwt-bearer |
| `quickstarts` | `fastapi_quickstart` | Protect a FastAPI API using auth0-fastapi-api |
| `quickstarts` | `fastify_api_quickstart` | Protect a Fastify API using @auth0/auth0-fastify-api |
| `quickstarts` | `vue_quickstart` | Add Auth0 login to a Vue 3 SPA using @auth0/auth0-vue |
| `quickstarts` | `nuxt_quickstart` | Add Auth0 login to a Nuxt app using @auth0/auth0-nuxt |

## Skills

In `agent+skills` mode, SKILL.md files are fetched from the [auth0/agent-skills](https://github.com/auth0/agent-skills) repository and prepended to the agent system prompt (`## Agent System`) alongside full tool access.

Each eval declares which skill it needs in its `PROMPT.md` frontmatter:

```yaml
---
skills: auth0-react
---
```

The runner fetches the corresponding `SKILL.md` from [auth0/agent-skills](https://github.com/auth0/agent-skills) on GitHub at runtime:

```
https://raw.githubusercontent.com/auth0/agent-skills/main/plugins/auth0/skills/<name>/SKILL.md
```

Fetched skills are cached in memory across parallel workers to avoid redundant HTTP calls. If an eval has no `skills:` declared, agent+skills mode runs identically to agent mode.

Multiple skills can be declared comma-separated:

```yaml
skills: auth0-react, auth0-nextjs
```

## Structure

```
src/
  run.ts                        # CLI entry point
  report.ts                     # HTML report generator
  config/
    settings.ts                 # API base URL, judge model, limits
    costs.ts                    # per-model token cost table
  runners/
    loader.ts                   # parses PROMPT.md, imports graders.ts
    baseline.ts                 # pure LLM, no tools
    skills.ts                   # fetches + injects SKILL.md into eval prompts (agent+skills mode)
  agent_eval/
    agent.ts                    # Agent loop (LLM calls, turn tracking)
    tools/
      base.ts                   # Tool interface, ToolContext, ToolResult types
      index.ts                  # Tool definitions (sent to LLM) + ALL_TOOLS registry
      ask-user.ts               # ask_user tool
      fetch-url.ts              # fetch_url tool
      finish-task.ts            # finish_task tool
      list-files.ts             # list_files tool
      read-file.ts              # read_file tool
      run-command.ts            # run_command tool
      write-file.ts             # write_file tool
      utils.ts                  # Shared file-traversal helpers
    tools-executor/
      index.ts                  # ToolExecutor — dispatches tool calls by name
    graders.ts                  # contains() / matches() / judge() primitives
    scorer.ts                   # 8-dimension scoring
  evals/
    <category>/
      <eval-id>/
        PROMPT.md               # task description + optional skills declaration
        graders.ts              # defineGraders() — acceptance criteria
        scaffold/               # optional starter files for agent workspace
  templates/
    report.html.j2              # Nunjucks HTML report template
  prompts/
    judge/                      # LLM-as-judge system prompts per framework
tests/                          # Vitest test suite
```

## Adding an Eval

> **Full guide:** [docs/ADDING_EVALS.md](docs/ADDING_EVALS.md)
>
> Covers folder structure, `PROMPT.md` authoring, the L1–L5 grader strategy, scaffold files, registration steps, and a submission checklist.

Quick summary:

1. Create `src/evals/<category>/<eval-id>/PROMPT.md` and `graders.ts`
2. Add `id` (required), `name`, and optionally `category` to `PROMPT.md` frontmatter — the framework auto-discovers evals from `evalsDir`
3. Assign every grader a `GraderLevel` (L1–L5) and include a holistic `judge` at the end — see [the grader levels guide](docs/ADDING_EVALS.md#grader-levels-l1l5) for what each level tests
4. Optionally add starter files in `scaffold/` and declare skills in frontmatter

Then rebuild: `npm run build`

## Claude Code Slash Commands

| Command | Purpose |
|---|---|
| `/evals-smoke-test` | End-to-end smoke test: builds the project, runs the full `react_quickstart` matrix across all models and configurations, generates an HTML report, and reports a PASS/FAIL verdict. Use after making framework changes to verify nothing is broken. |

Slash commands live in `.claude/commands/` and can be invoked from any Claude Code session inside this repo.

## Docker Sandbox

Agent-mode eval runs execute inside a sandboxed Docker container. The image is built automatically on first run if not present. To build manually:

```bash
npm run build && docker build -f docker/Dockerfile -t auth0-evals:latest .
```

The container is hardened with:
- All capabilities dropped (`--cap-drop=ALL`), only `NET_ADMIN` added temporarily for network setup
- Read-only root filesystem
- Network isolation: iptables rules block RFC 1918, link-local, and Docker bridge traffic (host/LAN unreachable) while allowing public internet
- `no-new-privileges` security option
- PID, memory, and CPU limits
- Workspace bind-mount validated to be under the OS temp directory
- Runs as non-root `node` user (privileges dropped after network setup)

To skip sandboxing (e.g. for local debugging):

```bash
npm run run -- --eval react_quickstart --mode agent --dangerously-skip-sandbox
```

## Development

```bash
npm install       # install dependencies
npm test          # run Vitest test suite
npm run build     # compile to dist/
```

## Requirements

Node.js 24+, Docker. Dependencies are managed via `npm`.
