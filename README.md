# auth0-evals

Evaluation framework for measuring how well LLM agents complete developer integration tasks.

## Quick Start

```bash
cp .env.example .env
# add your ATKO_API_KEY to .env

python run.py
python report.py
```

## Modes

| Mode | Description |
|------|-------------|
| `baseline` | Single LLM call, no tools |
| `skills` | Single LLM call with SDK reference docs prepended to context |
| `agent` | Full agentic loop with read/write/bash/fetch tools |

```bash
python run.py --mode baseline
python run.py --mode skills
python run.py --mode agent
```

## Options

```
--eval      Eval ID to run (default: all)
--model     Model to use (default: gpt-4o-mini)
--mode      baseline | skills | agent (default: agent)
--workers   Parallel workers (default: 4)
--output    JSON output path (default: scores-<mode>.json)
```

## Evals

Evals are organized by category. Each eval lives in `evals/<category>/<eval-id>/`.

| Category | ID | Description |
|----------|----|-------------|
| `ios` | `ios_auth0_integration` | Full Auth0 integration: login, logout, CredentialsManager, protected profile |
| `ios` | `ios_credentials_manager` | Add CredentialsManager to an existing auth stub |

More categories and SDKs will be added over time (quickstarts, Android, web, organizations, webhooks, etc.).

## Structure

```
run.py                          # single entry point
report.py                       # HTML report generator
config/
  evaluations.py                # central eval registry
evals/
  <category>/
    <eval-id>/
      PROMPT.md                 # plain-English task description + credentials
      graders.py                # define_graders() — acceptance criteria
      scaffold/                 # optional starter files for agent workspace
runners/
  loader.py                     # parses PROMPT.md, imports graders.py
  baseline.py                   # pure LLM, no tools
  skills.py                     # LLM + SDK reference docs prepended
agent_eval/
  agent.py                      # ReAct agent runner with tool execution
  graders.py                    # contains() / matches() / judge() primitives
  scorer.py                     # 5-dimension scoring
skills/
  <platform>/
    <sdk>.md                    # SDK reference material per platform
```

## Adding an Eval

1. Create `evals/<category>/<eval-id>/PROMPT.md`
2. Create `evals/<category>/<eval-id>/graders.py` with a `define_graders()` function
3. Optionally add starter files in `evals/<category>/<eval-id>/scaffold/`
4. Register it in `config/evaluations.py`

```python
EVALUATIONS = [
    {
        "id":       "your_eval_id",
        "name":     "Your Eval Name",
        "category": "your-category",
        "path":     "evals/your-category/your_eval_id",
    },
]
```

## Requirements

Python 3.11+. No third-party dependencies.
