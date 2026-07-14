# @a0/eval

CLI and agent runners for the eval framework. Provides the `a0-eval` binary, multi-model agent orchestration, 8-dimension scoring, and result persistence.

## Installation

`@a0/eval` is designed to be consumed as a workspace dependency. In your app's `package.json`:

```json
{
  "dependencies": {
    "@a0/eval": "*",
    "@a0/eval-graders": "*"
  }
}
```

Then wire up the CLI in your `scripts`:

```json
{
  "scripts": {
    "prerun": "npm run build",
    "run": "a0-eval",
    "prereport": "npm run build",
    "report": "a0-eval report"
  }
}
```

## Configuration

Create an `eval.config.js` (or `eval.config.mjs`) in your app root. The framework auto-discovers it from the working directory, similar to `vite.config.js`.

```js
// eval.config.js
/** @type {import('@a0/eval').FrameworkConfig} */
export default {
  // Required — directory containing your eval definitions
  evalsDir: 'src/evals',

  // LLM proxy for baseline + judge calls
  proxy: {
    baseUrl: 'https://your-proxy.example.com/v1',
  },

  // MCP servers available in agent+mcp mode
  mcp: {
    servers: {
      'my-docs': {
        type: 'http',
        url: 'https://example.com/mcp',
      },
    },
  },

  // Skill file sources for agent+skills mode
  skills: {
    remoteRepos: [
      {
        url: 'https://github.com/org/skills-repo.git',
        localPath: 'skills-remote/my-skills',
        skillsPath: 'plugins/skills',
      },
    ],
    localDirs: ['skills'],
  },

  // LLM-as-judge settings
  judge: {
    model: 'claude-sonnet-4-5',
    maxTokens: 1024,
    maxCodeChars: 16_384,
  },

  // Model registry
  models: {
    known: [
      'gpt-5.4', 'gpt-5.4-mini',
      'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-haiku-4-5',
      'gemini-3.1-pro-preview', 'gemini-3.5-flash',
    ],
    default: 'gpt-5.4',
  },
};
```

A `defineConfig` helper is available for type inference:

```js
import { defineConfig } from '@a0/eval';

export default defineConfig({
  evalsDir: 'src/evals',
});
```

### Configuration reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `evalsDir` | `string` | Yes | Directory containing eval definitions |
| `proxy.baseUrl` | `string` | Yes | LLM API base URL |
| `proxy.apiKey` | `string` | No | API key (falls back to `LLM_API_KEY` env var) |
| `mcp.servers` | `Record<string, MCPServerConfig>` | No | Named MCP server definitions |
| `skills.remoteRepos` | `RemoteSkillRepo[]` | No | Git repos containing skill files |
| `skills.localDirs` | `string[]` | No | Local directories with skill files |
| `judge.model` | `string` | Yes | Model for LLM-as-judge grading |
| `judge.maxTokens` | `number` | No | Max tokens for judge responses |
| `judge.maxCodeChars` | `number` | No | Max source code chars sent to judge |
| `models.known` | `string[]` | No | Models available via `--model all` |
| `models.default` | `string` | Yes | Default model when `--model` is omitted |
| `agents.<runner>.proxy` | `{ baseUrl }` | No | Per-agent proxy overrides |
| `workspace.excludedDirs` | `string[]` | No | Directories excluded from grading |

## CLI usage

### `a0-eval run`

Run evaluations. This is the default command.

```bash
a0-eval run [options]
# or simply:
a0-eval [options]
```

**Options:**

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--eval <id>` | Any eval ID | all evals | Eval to run (repeatable) |
| `--model <model>` | Any model string | `gpt-5.4` | Model to use (repeatable; `all` expands to the config's `models.known`, falling back to the built-in known-working list) |
| `--mode <mode>` | `baseline`, `agent`, `all` | `baseline` | `all` runs both modes in parallel |
| `--tools <tools>` | `skills`, `mcp`, or comma-separated | none | Agent-mode only |
| `--agent-type <type>` | `claude-code`, `copilot`, `gemini-cli` | auto-routed | Override agent runner selection |
| `--workers <n>` | number | 4 | Parallel job limit |
| `--output <path>` | file path | auto-named | JSON results output path |
| `--keep-workspace` | flag | off | Don't delete temp workspace after run |
| `--dangerously-skip-sandbox` | flag | off | Skip Docker sandbox (see warning below) |
| `--braintrust` | flag | off | Log results to Braintrust |
| `--config <path>` | file path | auto-discovered | Path to `eval.config.js` (overrides auto-discovery) |

**Examples:**

```bash
# Single eval, baseline mode
a0-eval --eval react_quickstart --mode baseline

# Agent mode with skills
a0-eval --eval react_quickstart --mode agent --tools skills

# All modes across all known models
a0-eval --mode all --model all

# Multiple models, agent mode with MCP
a0-eval --model claude-sonnet-4-6 --model gpt-5.4 --mode agent --tools mcp

# Keep workspace for debugging
a0-eval --eval react_quickstart --mode agent --keep-workspace
```

### `a0-eval report`

Generate an HTML report from a scores JSON file.

```bash
a0-eval report [--input scores.json] [--output report.html]
```

## Modes and configurations

| Configuration | CLI flags | Grader levels | What it measures |
|---|---|---|---|
| `baseline` | `--mode baseline` | L1–L3 | Training-data knowledge only |
| `agent` | `--mode agent` | L1–L4 | Value of tool access |
| `agent+skills` | `--mode agent --tools skills` | L1–L4 | Value of skill files |
| `agent+mcp` | `--mode agent --tools mcp` | L1–L5 | Value of MCP tools |
| `agent+mcp+skills` | `--mode agent --tools mcp,skills` | L1–L5 | Full compound effect |

## Agent runners

The framework auto-selects a runner based on model prefix, or you can override with `--agent-type`:

| Runner | ID | Auto-selected for |
|---|---|---|
| Claude Code | `claude-code` | `claude-*` models |
| GitHub Copilot | `copilot` | `gpt-*` models (and default fallback) |
| Gemini CLI | `gemini-cli` | `gemini-*` models |

### Claude Code runner

The Claude Code runner uses `@anthropic-ai/claude-agent-sdk` and routes through the configured LLM proxy like all other runners. Set `CLAUDE_CODE_USE_BEDROCK=1` to opt in to the Bedrock pass-through endpoint instead.

### Gemini CLI runner

The Gemini CLI runner routes through the LLM proxy. Set `agents['gemini-cli'].proxy.baseUrl` in your `eval.config.js` to point at your proxy and ensure your API key is configured in `.env`.

## Scoring

Agent-mode runs are scored across 8 dimensions, each 0–100, combined by weighted sum:

### Process dimensions (50%)

| Dimension | Weight | What it measures |
|---|---|---|
| Setup Friction | 12% | Clean completion without human intervention |
| Setup Speed | 12% | Active tool-call time (ideal: ≤60s) |
| Efficiency | 12% | Focused work vs. thrashing (duplicate reads, overwritten writes) |
| Error Recovery | 7% | Resilience to provider errors |
| Docs Quality | 7% | Effective use of documentation when fetched |

### Output dimensions (50%)

| Dimension | Weight | What it measures |
|---|---|---|
| Correctness | 25% | Pass rate of L1/L4/L5 graders + holistic judge |
| Hallucination | 15% | Pass rate of L2 graders (wrong packages, invented APIs) |
| Security | 10% | Pass rate of L3 graders (hardcoded secrets, insecure storage) |

### Grade thresholds

| Grade | Min score |
|---|---|
| A | 90 |
| B | 75 |
| C | 60 |
| D | 40 |
| F | < 40 |

Baseline runs only produce grader pass rates — no 8-dimension scoring.

## Grader levels

Each grader has a level that determines which configurations it runs in:

| Level | What it tests | Active in |
|---|---|---|
| L1 — Positive presence | Required SDK symbols, imports, config keys | All configurations |
| L2 — Hallucination | Hallucinated packages, wrong SDK variants | All configurations |
| L3 — Security | No hardcoded credentials or insecure storage | All configurations |
| L4 — Structural | Correct wiring, right components, lifecycle | Agent configurations only |
| L5 — Version correctness | Current API, not deprecated patterns | Agent+MCP configurations only |

Ideally, evals end with a holistic `judge` grader (no level) that always runs regardless of configuration. Some existing evals use levelled judges instead — see each eval's `graders.ts` for specifics.

## Docker sandbox

Agent-mode runs execute inside a hardened Docker container by default. The image is built automatically on first run. To build manually (run from the **monorepo root**):

```bash
# Run from the monorepo root
docker build -f docker/Dockerfile -t auth0-evals:latest .
```

You can disable sandboxing with `--dangerously-skip-sandbox`, but be aware that this runs LLM-generated code directly on your host machine with full filesystem and network access. Only use this for debugging on a machine you're comfortable treating as disposable.

## Result merging

Results are merged into the output file by `(eval_id, model, mode)` key. Re-running a single model updates only its entries — scores for all other models are preserved:

```bash
# Build the full baseline
a0-eval --model all

# Later, re-run one model without losing the rest
a0-eval --model gpt-5.4
```
