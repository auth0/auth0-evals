# auth0-evals

Evaluation framework for measuring how well LLM agents complete developer integration tasks.

## Quick Start

```bash
cp .env.example .env
# add your ATKO_API_KEY to .env

python run.py --mode baseline
python report.py
```

### Run with multiple models and modes

```bash
# Quick test - baseline mode with gpt-4o-mini (fastest)
python run.py --eval react_quickstart --mode baseline

# Test all modes with one model
python run.py --eval react_quickstart --mode all --model gpt-4o-mini

# Run all known working models in baseline mode
python run.py --model all --mode baseline

# Run specific models across all modes
python run.py --model gpt-4o --model gpt-4-turbo --mode all

# Full evaluation - all modes × all models (13 jobs, ~15s with 8 workers)
python run.py --eval react_quickstart --mode all --model all --workers 8

# Run everything (all evals × all models × all modes)
python run.py --mode all --model all

# Generate HTML report from results
python report.py --input scores-all-modes.json

# Run and view results in one command
python run.py --eval react_quickstart --mode all --model all && python report.py --input scores-all-modes.json && open report.html
```

**Note:** Bedrock models (claude-4-5-sonnet, claude-4-5-haiku) are automatically skipped in agent mode but run in baseline/skills modes.

## Modes

| Mode | Description |
|------|-------------|
| `baseline` | Single LLM call, no tools (default) |
| `skills` | Single LLM call with SKILL.md files prepended to context |
| `agent` | Full agentic loop with read/write/bash/fetch tools |

Use `--mode all` to run all three modes in parallel for faster evaluation.

## Options

```
--eval      Eval ID to run (default: all). Can be repeated.
--model     Model to use (default: gpt-4o-mini). Can be repeated for multiple models.
            Use 'all' to run all known working models.
--mode      baseline | skills | agent | all (default: baseline)
            Use 'all' to run all three modes in parallel.
--workers   Parallel workers (default: 4)
--output    JSON output path (default: scores-<mode>.json or scores-all-modes.json)
--keep-workspace   (agent mode only) Keep temp workspace after run
```

### Known Working Models

The framework maintains a list of models that work reliably across all modes (baseline, skills, and agent):

**OpenAI:**
- `gpt-4o-mini` (default)
- `gpt-4o`
- `gpt-4-turbo`

**Note:** Model availability depends on your ATKO API key configuration. Bedrock Claude models (`claude-4-5-*`) require special toolConfig and will fail in agent mode.

## Evals

| Category | ID | Description |
|----------|----|-------------|
| `quickstarts` | `react_quickstart` | Add Auth0 authentication to a React app using @auth0/auth0-react |
| `quickstarts` | `swift_quickstart` | Add Auth0 authentication to a Swift iOS app using Auth0.swift |

## Skills

In `skills` mode, SKILL.md files are fetched from the [auth0/agent-skills](https://github.com/auth0/agent-skills) repository and injected into the system prompt before the LLM call.

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

Fetched skills are cached in memory across parallel workers to avoid redundant HTTP calls. If an eval has no `skills:` declared, skills mode runs without any injected context.

Multiple skills can be declared comma-separated:

```yaml
skills: auth0-react, auth0-nextjs
```

## Structure

```
run.py                          # single entry point
report.py                       # HTML report generator
config/
  evaluations.py                # central eval registry
evals/
  <category>/
    <eval-id>/
      PROMPT.md                 # task description + optional skills declaration
      graders.py                # define_graders() — acceptance criteria
      scaffold/                 # optional starter files for agent workspace
runners/
  loader.py                     # parses PROMPT.md, imports graders.py
  baseline.py                   # pure LLM, no tools
  skills.py                     # LLM + SKILL.md files prepended
agent_eval/
  agent.py                      # ReAct agent runner with tool execution
  graders.py                    # contains() / matches() / judge() primitives
  scorer.py                     # 5-dimension scoring (friction, speed, efficiency, errors, docs)
```

## Adding an Eval

1. Create `evals/<category>/<eval-id>/PROMPT.md`
2. Create `evals/<category>/<eval-id>/graders.py` with a `define_graders()` function
3. Optionally declare a skill in `PROMPT.md` frontmatter (`skills: auth0-react`)
4. Optionally add starter files in `evals/<category>/<eval-id>/scaffold/`
5. Register it in `config/evaluations.py`

```python
EVALUATIONS = [
    {
        "id":       "your_eval_id",
        "name":     "Your Eval Name",
        "category": "your-category",
        "path":     "evals/<category>/your_eval_id",
    },
]
```

## Requirements

Python 3.11+. No third-party dependencies.
