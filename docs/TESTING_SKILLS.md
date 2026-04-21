# Testing Skills Locally

This guide covers how to run evals against a skill you are developing locally — without having to push `SKILL.md` to the [auth0/agent-skills](https://github.com/auth0/agent-skills) remote repo first.

---

## When to use this

- You are authoring a new skill and want fast iteration loops.
- You are editing an existing skill and need to verify the agent still passes before opening a PR.
- You are working offline or in an environment without access to GitHub.

---

## How skills are resolved

The runner supports three resolution modes, controlled by the `SKILLS_SOURCE` environment variable:

| `SKILLS_SOURCE` | Behaviour |
|---|---|
| `auto` *(default)* | Tries remote GitHub first. If the fetch fails, falls back to `skills/` in this repo. |
| `local` | Reads only from the local `skills/` directory. No network calls. |
| `remote` | Reads only from remote GitHub. Original behaviour. |

Set this in your `.env` file (never inline on the command — keep your workflow reproducible).

---

## Step-by-step

### 1. Write your skill file

Create `skills/<name>/SKILL.md` in this repo, mirroring the structure of the remote:

```
auth0-evals/
└── skills/
    └── auth0-react/        ← skill name (must match the `skills:` field in PROMPT.md)
        └── SKILL.md        ← your skill content
```

The `skills/` directory is already committed to the repo and gitignored content is up to you.

### 2. Tell the runner to use local

Add to your `.env`:

```bash
SKILLS_SOURCE=local
```

### 3. Run the eval

```bash
# Run your eval in agent+skills mode
npm run run -- --eval react_quickstart --mode agent --tools Skills

# Keep the workspace to inspect what the agent produced
npm run run -- --eval react_quickstart --mode agent --tools Skills --keep-workspace
```

The runner will log the source for each skill loaded:

```
[skills] 'auth0-react': loaded from local (/path/to/auth0-evals/skills/auth0-react/SKILL.md)
```

### 4. Compare against the baseline

Run all 4 combos to measure the delta your skill provides:

```bash
npm run run -- --eval react_quickstart --mode matrix --model gpt-5.2
npm run report -- --input scores-matrix.json && open report.html
```

The delta between `agent` and `agent+skills` is the signal. If the skill helps, it will show up as a grader pass-rate or score increase in `agent+skills` vs `agent`.

### 5. Iterate

Edit `skills/<name>/SKILL.md` and re-run. The runner does not cache across processes, so each run picks up your latest changes.

### 6. Push and remove local override

Once the skill produces the results you want:

1. Push `SKILL.md` to [auth0/agent-skills](https://github.com/auth0/agent-skills).
2. Remove or comment out `SKILLS_SOURCE=local` from `.env`.
3. Re-run the eval to confirm the remote version produces the same results.

```bash
# Verify remote parity
npm run run -- --eval react_quickstart --mode agent --tools Skills
```

---

## Using a custom directory

If your skill files live outside the default `skills/` directory (for example, in a local checkout of `auth0/agent-skills`):

```bash
# .env
SKILLS_SOURCE=local
SKILLS_LOCAL_DIR=/path/to/agent-skills/plugins/auth0/skills
```

`SKILLS_LOCAL_DIR` accepts both absolute paths and paths relative to where you run the command.

---

## Auto fallback

If you leave `SKILLS_SOURCE=auto` (the default), the runner tries the remote first and falls back to your local `skills/` directory on any failure. This is useful when:

- You want remote skills for most evals but have a local override for one you are developing.
- You are in an environment with intermittent network access.

The fallback is logged explicitly:

```
[skills] 'auth0-react': remote unavailable, using local fallback
```
