# auth0-evals

Evaluation framework for measuring how well LLM agents complete developer integration tasks.

## Quick Start

```bash
cp .env.example .env
# add your ATKO_API_KEY to .env

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run all evals × all models × all modes (recommended)
python run.py --mode all --model all --workers 8

# Generate and view report
python report.py
```

### Run with multiple models and modes

```bash
# Quick test - baseline mode with default model
python run.py --eval react_quickstart --mode baseline

# Test all modes with one model
python run.py --eval react_quickstart --mode all --model gpt-5.2

# Run all known working models in baseline mode
python run.py --model all --mode baseline

# Run specific models across all modes
python run.py --model claude-4-6-sonnet --model claude-4-6-opus --mode all

# Full evaluation - all modes × all models
python run.py --eval react_quickstart --mode all --model all --workers 8

# Run everything (all evals × all models × all modes)
python run.py --mode all --model all

# Generate HTML report from results
python report.py --input scores-all-modes.json

# Run and view results in one command
python run.py --eval react_quickstart --mode all --model all && python report.py --input scores-all-modes.json && open report.html
```

## Modes

| Mode | Description |
|------|-------------|
| `baseline` | Single LLM call, no tools (default) |
| `skills` | Single LLM call with SKILL.md files prepended to context |
| `agent` | Full agentic loop with read/write/bash/fetch tools |

Use `--mode all` to run all three modes in parallel for faster evaluation.

## Models

| Model | ID |
|-------|----|
| GPT-5.2 | `gpt-5.2` |
| Claude Sonnet 4.6 | `claude-4-6-sonnet` |
| Claude Opus 4.6 | `claude-4-6-opus` |
| Gemini 3 Pro | `gemini-3-pro-preview` |

```bash
# Run with a specific model
python run.py --model gpt-5.2
python run.py --model claude-4-6-sonnet
python run.py --model claude-4-6-opus
python run.py --model gemini-3-pro-preview

# Run with multiple models
python run.py --model claude-4-6-sonnet --model claude-4-6-opus

# Run with a specific model and mode
python run.py --model gpt-5.2 --mode agent
```

Results are merged into the output file by `(eval_id, model, mode)` key. Re-running a single model updates only its entries — scores for all other models are preserved.

```bash
# Run all models once to build the full baseline
python run.py --model all

# Later, re-run only one model without losing the rest
python run.py --model gpt-5.2
```

## Options

```
--eval      Eval ID to run (default: all). Can be repeated.
--model     Model to use (default: gpt-5.2). Can be repeated for multiple models.
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

Python 3.11+. Dependencies are listed in `requirements.txt`.
