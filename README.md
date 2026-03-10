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
--model     Model to use (default: gpt-4o-mini). Can be repeated for multiple models.
--mode      baseline | skills | agent (default: agent)
--workers   Parallel workers (default: 4)
--output    JSON output path (default: scores-<mode>.json)
```

## Evals

| Category | ID | Description |
|----------|----|-------------|
| `ios` | `ios_auth0_integration` | Full Auth0 integration: login, logout, CredentialsManager, protected profile |
| `ios` | `ios_credentials_manager` | Add CredentialsManager to an existing auth stub |
| `quickstarts` | `react_quickstart` | Add Auth0 authentication to a React app using @auth0/auth0-react |

## Skills

In `skills` mode, SDK reference material is injected into the system prompt before the LLM call.

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
  skills.py                     # LLM + SDK reference docs prepended
agent_eval/
  agent.py                      # ReAct agent runner with tool execution
  graders.py                    # contains() / matches() / judge() primitives
  scorer.py                     # 5-dimension scoring
skills/
  <sdk>.md                      # local SDK reference (fallback when no skills: declared)
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
        "path":     "evals/your-category/your_eval_id",
    },
]
```

## Requirements

Python 3.11+. No third-party dependencies.
