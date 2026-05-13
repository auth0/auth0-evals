# Testing Skills Locally

This guide covers how to run evals against a skill you are developing locally — without having to push `SKILL.md` to the [auth0/agent-skills](https://github.com/auth0/agent-skills) remote repo first.

---

## When to use this

- You are authoring a new skill and want fast iteration loops.
- You are editing an existing skill and need to verify the agent still passes before opening a PR.
- You are working offline or in an environment without access to GitHub.

---

## How skills are resolved

Skills are resolved by the `SkillsManager` using the `skills` configuration in `eval.config.js`. The manager checks directories in a fixed order:

1. **Local directories** — checked first, in the order listed in `skills.localDirs`
2. **Remote repositories** — checked next, in the order listed in `skills.remoteRepos`

First match wins. This means a local skill always takes precedence over a remote one with the same name.

```javascript
// eval.config.js
export default {
  skills: {
    localDirs: ['skills'],               // checked first
    remoteRepos: [
      {
        url: 'https://github.com/auth0/agent-skills.git',
        localPath: 'skills-remote/auth0-skills',
        skillsPath: 'plugins/auth0/skills',
      },
    ],
  },
};
```

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

### 2. Run the eval

```bash
# Run your eval in agent+skills mode
npm run run -- --eval react_quickstart --mode agent --tools Skills

# Keep the workspace to inspect what the agent produced
npm run run -- --eval react_quickstart --mode agent --tools Skills --keep-workspace
```

The runner logs skill delivery. What you see depends on the agent type:

- **Filesystem-native agents** (Claude Code, Copilot, Gemini CLI) copy skill files into the workspace:
  ```
  [skills] Copied 2 file(s) for 'auth0-react' → .claude/skills/auth0-react/
  ```
- **Copilot / other runners** (default) receive skill files copied directly into the workspace before the agent starts.

Since local directories are checked before remote repos, your local `skills/auth0-react/` will automatically take precedence over the remote version.

### 3. Compare against the baseline

Run all 4 combos to measure the delta your skill provides:

```bash
npm run run -- --eval react_quickstart --mode matrix --model gpt-5.2
npm run report -- --input scores-matrix.json && open report.html
```

The delta between `agent` and `agent+skills` is the signal. If the skill helps, it will show up as a grader pass-rate or score increase in `agent+skills` vs `agent`.

### 4. Iterate

Edit `skills/<name>/SKILL.md` and re-run. The runner does not cache across processes, so each run picks up your latest changes.

### 5. Push and remove local override

Once the skill produces the results you want:

1. Push `SKILL.md` to [auth0/agent-skills](https://github.com/auth0/agent-skills).
2. Remove the local `skills/<name>/` directory so the remote version is used.
3. Re-run the eval to confirm the remote version produces the same results.

```bash
# Verify remote parity
npm run run -- --eval react_quickstart --mode agent --tools Skills
```

---

## Using a custom directory

If your skill files live outside the default `skills/` directory (for example, in a local checkout of `auth0/agent-skills`), add it to the `localDirs` array in `eval.config.js`:

```javascript
// eval.config.js
export default {
  skills: {
    localDirs: [
      '/path/to/agent-skills/plugins/auth0/skills',
      'skills',  // keep the default too
    ],
    remoteRepos: [/* ... */],
  },
};
```

Directories are checked in order — put your custom path first if you want it to take priority.

---

## Offline / no remote

If you have no remote repos configured (or all clones fail), the manager logs a warning and resolves skills from local directories only. No network calls are made unless `remoteRepos` is configured.
