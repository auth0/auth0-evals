# Architecture

`auth0-evals` is a **TypeScript monorepo** (npm workspaces + Turbo) that runs LLM coding agents against Auth0 SDK integration tasks and scores the code they produce.

It does two things:

1. **Measures the Agent Experience (AX) of integrating Auth0** — how well AI coding agents complete real Auth0 integration tasks.
2. **Produces actionable insights to improve it** — concrete fixes for the three investments behind Auth0's [Agent Experience](https://auth0.com/agent-experience): **Auth0 skills** ([auth0/agent-skills](https://github.com/auth0/agent-skills)), the **Auth0 docs MCP server**, and the **Auth0 docs**.

The loop: run a realistic integration task across multiple agents and investment levels, grade the generated code, and turn each score into a fix. The guiding belief — **every score must point to a fix**.

## Architecture Diagram

An `a0-eval run` expands into a job matrix (eval × model × mode × tools); each job walks the same six stages — **Kick off → Prepare → Run the agent → Grade → Score → Report** — fanning out under a `pLimit(workers)` gate (one subprocess and Docker sandbox per job) and converging at `mergeResults()`. Every box names the function behind it, so the diagram doubles as a call map. Colours mark the layer: control plane (`@a0/evals` + `@a0/evals-core`), execution plane (the runner + Auth0 tools it reads), data plane (the artifacts it leaves behind).

```mermaid
%%{init: {'theme':'base', 'themeVariables': {
  'fontFamily':'ui-sans-serif, system-ui, sans-serif',
  'fontSize':'15px',
  'lineColor':'#495057','primaryTextColor':'#1A1A2E'
}}}%%
flowchart TB
    subgraph RowA[" "]
        direction LR
        subgraph CLI["1 · Kick off — @a0/evals"]
            direction TB
            Bin["Start a run<br/>bin.ts (local or CI)"]
            Auth["Resolve credential<br/>validateApiKey() + resolveProxyAuthHeader()<br/>LLM_API_KEY wins when set"]
            Matrix["Plan the work<br/>buildJobList()<br/>eval × model × mode × tools"]
            Pool["Run jobs in parallel<br/>pLimit(workers) · spawnEval()"]
            Bin --> Auth --> Matrix --> Pool
        end

        subgraph Setup["2 · Prepare each job — @a0/evals-core"]
            direction TB
            Discover["Find the eval<br/>discoverEvals() + loadEval()"]
            WS["Clean workspace + scaffold<br/>setupWorkspace()"]
            Discover --> WS
        end

        subgraph Exec["3 · Run the agent — @a0/evals"]
            direction TB
            Runners["Coding agent (runner)<br/>Claude Code · Codex · Gemini CLI · Copilot"]
            Invest["Helped by Auth0 tools<br/>agent skills + Auth0 docs MCP server"]
            Runners -. reads .-> Invest
        end
    end

    subgraph RowB[" "]
        direction LR
        subgraph Grade["4 · Grade the code — @a0/evals-core"]
            direction TB
            Engine["Automated checks<br/>runGraders() · L1–L5"]
            Judge["AI judge<br/>llmJudge() · claude-opus-5"]
            Engine --> Judge
        end

        subgraph Score["5 · Score the run — @a0/evals"]
            direction TB
            Scorer["8-dimension score<br/>score() + A–F grade"]
            Recs["Suggested fixes<br/>generateRunRecommendations()"]
            Scorer --> Recs
        end

        subgraph Storage["6 · Report"]
            direction TB
            Results[("Results<br/>scores-*.json")]
            Report["Leaderboard<br/>renderHtml() → report.html"]
            BT[("Braintrust<br/>--braintrust (optional)")]
            Results --> Report
            Results -. optional .-> BT
        end
    end

    Pool ==> Discover
    WS ==> Runners
    Runners ==> Engine
    Judge ==> Scorer
    Recs ==> Results
    Auth -. credential .-> Runners
    Auth -. credential .-> Judge

    classDef control fill:#E7F0FF,stroke:#4C6EF5,color:#1A1A2E;
    classDef work    fill:#FFE8CC,stroke:#E8590C,color:#1A1A2E;
    classDef data    fill:#D3F9D8,stroke:#2F9E44,color:#1A1A2E;

    class Bin,Auth,Matrix,Pool,Discover,WS,Engine,Judge,Scorer,Recs control;
    class Runners,Invest work;
    class Results,Report,BT data;

    classDef cluster fill:#FFFDF2,stroke:#E9D8A6,color:#5C4A1A;
    class CLI,Setup,Exec,Grade,Score,Storage cluster;
    style RowA fill:none,stroke:none;
    style RowB fill:none,stroke:none;
```

## Component responsibilities

Bottom-up, with a clean acyclic dependency graph (`@a0/evals-graders` is the leaf, built first):

### `@a0/evals-graders`
- **Purpose**: Grader primitive factories + level taxonomy.
- **Responsibilities**: Produce `GraderDef` descriptors (`contains`, `notContains`, `notContainsInSource`, `matches`, `judge`, `ranCommand`, `ranCommandOneOf`, `wroteFile`); define `GraderLevel` (L1–L5) and validate that event graders use L4/L5 only. Text-search graders (`contains`, `notContains`, `matches`, `judge`) accept a `source` option (`'files' | 'response' | 'both'`, default `'files'`) — set `source: 'response'` or `source: 'both'` to include the agent's final reply text in the search corpus (needed for MCP-only evals where the agent never writes files).
- **Dependencies**: None (leaf).
- **Type**: Shared library / SDK.

### `@a0/evals-core`
- **Purpose**: Evaluation engine.
- **Responsibilities**: Eval discovery (`discoverEvals`) and loading (`loadEval`); framework config load/merge (`loadConfig`, `defineConfig`); workspace lifecycle (`setupWorkspace`, `cleanupWorkspace`, `writeAgentGuidance`); grader engine with a pluggable executor **registry** (`registerExecutor`/`getExecutor`/`executeGrader`); LLM judge; the `AgentRunner` and `ToolTranslator` interfaces; trace classification; result serializers.
- **Dependencies**: `@a0/evals-graders`.
- **Type**: Application infrastructure / engine.

### `@a0/evals`
- **Purpose**: CLI, orchestration, runners, scoring, insight, persistence, reporting glue.
- **Responsibilities**: Flag parsing (`commander`); job-matrix build with model-prefix auto-routing; worker-pool parallelism (`p-limit`) + per-job subprocess spawning; Docker sandbox lifecycle; four concrete agent runners + baseline; 8-dimension scorer + waste analysis; recommendation generator; result persistence/merge; Braintrust reporter.
- **Sandbox entry point**: `cli/sandbox-runner.ts` (invoked by `docker/entrypoint.sh`) scores and generates recommendations **inside** the sandbox, so the host only reads back the resulting JSON.
- **Dependencies**: `@a0/evals-core`, `@a0/evals-reporter`, agent SDKs (`@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@github/copilot-sdk`, `@google/gemini-cli`), `ai` + `@ai-sdk/openai`, `braintrust`, `commander`, `p-limit`, `dotenv`.
- **Type**: Application (publishes the `a0-eval` binary).

### `@a0/evals-reporter`
- **Purpose**: HTML leaderboard rendering.
- **Responsibilities**: `groupResults`/`groupByVariant`/`computeDeltas`; Nunjucks template (`report.html.j2`) with CSS-class and markdown filters; aggregate cost/run stats; ordered variant display.
- **Dependencies**: `@a0/evals-core`, `@a0/evals-graders`, `marked`, `nunjucks`.
- **Type**: Application infrastructure / reporting.

### `@a0/evals-axis`
- **Purpose**: AXIS integration bridge.
- **Responsibilities**: Wraps `@netlify/axis` `run()` and layers auth0-evals graders on top of every job result. Exposes `runAxis()` (orchestrates the full AXIS run + grader hook), `buildAxisScores()` (maps `ScoredOutput` + `GraderResult[]` into the `AgentJobResult[]` shape that `@a0/evals-reporter` expects, written as `scores-axis.json`), and `buildReportManifest()` (converts `ScoredOutput` + `GraderResult[]` into the `ReportManifest` consumed by `@netlify/axis`'s `generateReportHtml()`, written as `report-axis.html`). The grader hook (`runAuth0Graders`) fires inside the `onResult` callback — before AXIS tears down the workspace — and runs L1–L4 graders against the live workspace. `axisTranscriptToToolCalls()` translates the AXIS transcript into the `EventToolCall[]` format the grader engine understands.
- **Dependencies**: `@a0/evals-core`, `@a0/evals-graders`, `@netlify/axis`.
- **Type**: Application infrastructure / bridge.

### `apps/auth0-evals`
- **Purpose**: Auth0's concrete deployment.
- **Responsibilities**: The 14-eval suite (`src/evals/**`), `eval.config.js` (proxy, models, MCP server, skills sources, judge, scoring allowlist), the React scaffolds, and the local skills dir. Publishes thin `evals`/`report` npm scripts that shell out to `a0-eval`, and an `axis` script (`src/axis/run.ts`) that wires AXIS to the eval suite via `axis.config.ts`.
- **Dependencies**: `@a0/evals`, `@a0/evals-axis`, `@a0/evals-graders`, `@a0/evals-reporter`, `commander`.
- **Type**: Application / deployment.

## Runners (auto-routed by model prefix)

| Runner | Models | SDK |
|---|---|---|
| `claude-code` | `claude-*` | `@anthropic-ai/claude-agent-sdk` (`query()`) |
| `codex` | `gpt-*` | `@openai/codex-sdk` (`thread.runStreamed()`) |
| `gemini-cli` | `gemini-*` | `@google/gemini-cli` |
| `copilot` | else (default) | `@github/copilot-sdk` |
| `baseline` | any (no tools) | `ai` + `@ai-sdk/openai` single-shot |

New runners plug in via `registerRunner(id, impl)` with no dispatcher changes (Registry + Strategy).

Each runner ships a `ToolTranslator` that normalizes its SDK's tool names to one **canonical vocabulary** — `run_command`, `read_file`, `write_file`, `list_files`, `fetch_url`, `ask_user` — so trace classification, waste analysis, and scoring see the same signals regardless of vendor (`base-translator.ts`, `runners/classify.ts`).

## Grader levels

| Level | Enum | Tests | Runs in |
|---|---|---|---|
| L1 | `positive_presence` | required SDK symbols/imports present | all configs |
| L2 | `hallucination` | hallucinated packages absent | all configs |
| L3 | `security` | no hardcoded secrets | all configs |
| L4 | `structural` | code correctly wired | agent configs |
| L5 | `version_correctness` | current API, not deprecated | agent+mcp configs |

Every eval ends with one holistic `judge()` with **no level** — it always runs.

> Full authoring detail (per-level intent, code examples): [`docs/ADDING_EVALS.md`](ADDING_EVALS.md).

## The 5 configurations

Each configuration adds **exactly one variable**, so the delta between two adjacent columns *is* the measured value of that investment.

| Configuration | CLI flags | Isolates | Grader levels |
|---|---|---|---|
| `baseline` | `--mode baseline` | Training-data knowledge | L1–L3 |
| `agent` | `--mode agent` | + agentic loop / tools | L1–L4 |
| `agent+skills` | `--mode agent --tools skills` | + SKILL.md in context | L1–L4 |
| `agent+mcp` | `--mode agent --tools mcp` | + Auth0 docs MCP | L1–L5 |
| `agent+mcp+skills` | `--mode agent --tools mcp,skills` | full investment | L1–L5 |

## End-to-end data flow

```mermaid
%%{init: {'theme':'base', 'mirrorActors': false, 'themeVariables': {
  'primaryColor':'#E7F0FF','primaryBorderColor':'#4C6EF5','primaryTextColor':'#1A1A2E',
  'actorBkg':'#E7F0FF','actorBorder':'#4C6EF5','actorTextColor':'#1A1A2E',
  'signalColor':'#495057','signalTextColor':'#1A1A2E','noteBkgColor':'#FFF9DB','noteBorderColor':'#F08C00',
  'fontFamily':'ui-sans-serif, system-ui, sans-serif'
}}}%%
sequenceDiagram
    box rgba(231,240,255,0.6) CLI and Orchestration
        participant U as User / CI
        participant CLI as run.ts
    end
    box rgba(255,232,204,0.55) Execution
        participant Exec as Sandbox / Local
        participant Agent as Runner
    end
    box rgba(211,249,216,0.5) Engine
        participant Grade as runGraders
        participant Score as score()
    end
    box rgba(243,232,255,0.55) Insight and Output
        participant Recs as recommendations
        participant Rep as reporter
    end

    U->>CLI: a0-eval --eval react_quickstart --mode agent --tools mcp
    CLI->>CLI: validateApiKey() + resolveProxyAuthHeader()
    Note over CLI: LLM_API_KEY wins when set;<br/>else proxy.authHeader + its tokenEnv
    CLI->>CLI: buildJobList() → matrix

    loop per job [eval × model × mode × tools]
        CLI->>CLI: spawnEval() — one subprocess
        CLI->>Exec: setupWorkspace() + dispatch (Docker / local)
        Note over Exec: sandbox.passthroughEnv forwards the<br/>token var into the container
        Exec->>Agent: run task in workspace (credential injected —<br/>native key header, or the configured proxy header)
        Agent-->>Exec: edited workspace + RunRecord trace (includes finalSummary)
        Exec->>Grade: runGraders(workspace, levels, agentText?)
        Note over Grade: agentText = record.finalSummary<br/>searched only when grader sets source: 'response' | 'both'
        Grade->>Grade: LLM-judge for judge graders (same credential resolution)
        Grade-->>Score: GraderResult[]
        Score->>Score: 8 dimensions → overall + grade
        opt skills or MCP active
            Score->>Recs: ask judge LLM for fixes
            Note over Recs: see "Recommendations":<br/>grader / skill / mcp / efficiency
        end
        Recs-->>CLI: scores-*.json (+ recommendations)
    end

    CLI->>CLI: mergeIntoOutput() — dedup by eval|model|mode|tools
    CLI->>Rep: a0-eval report → report.html
```

## AXIS integration

`npm run axis` is a **second run path** that delegates execution to [AXIS](https://github.com/netlify/axis) — Netlify's multi-agent evaluation framework — and layers auth0-evals graders on top. It runs the same tasks across **claude-code, codex, and gemini in a single pass** with no Docker dependency (AXIS manages its own workspace isolation).

The bridge lives in `@a0/evals-axis`. `apps/auth0-evals/src/axis/run.ts` is the entry point; `apps/auth0-evals/axis.config.ts` auto-discovers evals as AXIS scenarios by calling `discoverEvals()` on every run (a fast filesystem scan — no caching needed).

```mermaid
%%{init: {'theme':'base', 'mirrorActors': false, 'themeVariables': {
  'primaryColor':'#E7F0FF','primaryBorderColor':'#4C6EF5','primaryTextColor':'#1A1A2E',
  'actorBkg':'#E7F0FF','actorBorder':'#4C6EF5','actorTextColor':'#1A1A2E',
  'signalColor':'#495057','signalTextColor':'#1A1A2E','noteBkgColor':'#FFF9DB','noteBorderColor':'#F08C00',
  'fontFamily':'ui-sans-serif, system-ui, sans-serif'
}}}%%
sequenceDiagram
    box rgba(231,240,255,0.6) CLI and Config
        participant U as User / CI
        participant Run as axis/run.ts
        participant Config as axis.config.ts
    end
    box rgba(255,232,204,0.55) AXIS
        participant Axis as runAxis()
        participant Agent as Agent (claude-code / codex / gemini)
    end
    box rgba(211,249,216,0.5) Graders
        participant Hook as runAuth0Graders()
        participant GE as runGraders()
    end
    box rgba(243,232,255,0.55) Output
        participant Build as buildAxisScores()
        participant Manifest as buildReportManifest()
        participant Out as scores-axis.json + report-axis.html
    end

    U->>Run: npm run axis [--eval id] [--agent name] [--model model]
    Run->>Config: discoverEvals() → scenarios[]
    Run->>Axis: runAxis({ configPath, frameworkRoot, apiKey })

    loop per job [scenario × agent]
        Axis->>Agent: run task in isolated workspace
        Agent-->>Axis: edited workspace + transcript
        Axis->>Hook: onResult hook (before workspace teardown)
        Hook->>GE: runGraders(workspace, L1–L4, agentText?)
        Note over GE: agentText = result.output.result<br/>searched only when grader sets source: 'response' | 'both'
        GE-->>Hook: GraderResult[]
        Hook-->>Axis: GraderResult[]
    end

    Axis->>Axis: AXIS 4-dimension judge (goal / environment / service / agent)
    Axis-->>Run: { scoredOutput, graderResults }
    Run->>Build: buildAxisScores(scoredOutput, graderResults)
    Build-->>Out: AgentJobResult[] → scores-axis.json
    Run->>Manifest: buildReportManifest(scoredOutput, graderResults)
    Manifest-->>Out: ReportManifest → generateReportHtml() → report-axis.html
```

### How AXIS and auth0-evals scoring combine

AXIS scores every job on **4 dimensions** (0–10 each) via its own LLM judge. auth0-evals adds **L1–L4 grader pass rates** alongside. `buildAxisScores()` maps the combined result into the same `AgentJobResult` shape that `a0-eval run` produces, written as `scores-axis.json` so `npm run report` renders both in a unified leaderboard. `buildReportManifest()` converts the same data into the `ReportManifest` shape consumed by `@netlify/axis`'s `generateReportHtml()`, producing `report-axis.html` — the native AXIS report UI.

| Source | What it measures |
|---|---|
| AXIS — Goal Achievement | Did the agent satisfy the overall task goal? |
| AXIS — Environment | Did the agent leave the environment in a clean state? |
| AXIS — Service | Did the agent use the right services correctly? |
| AXIS — Agent | Did the agent work efficiently without unnecessary steps? |
| auth0-evals L1–L4 graders | Required symbols, no hallucinations, no secrets, correct wiring |

### Key differences from `a0-eval run`

| | `a0-eval run` | `npm run axis` |
|---|---|---|
| Sandbox | Docker (per-job container) | AXIS-managed workspace isolation |
| Agents | one model/runner per run | claude-code, codex, gemini in one pass |
| Scoring | 8-dimension weighted sum | AXIS 4-dimension judge + grader pass rates |
| Modes | baseline, agent, agent+mcp, … | agent only (no baseline, no MCP toggle) |
| Output | `scores-agent.json` / `scores-baseline.json` | `scores-axis.json` + `report-axis.html` |

## Scoring — 8 dimensions

The overall score is a **weighted sum** of 8 dimensions, split evenly between *how* the agent worked (Process, 50%) and *what* it produced (Output, 50%). Process dimensions are **zeroed when the agent never executed** (0 tool calls), so a no-op run can't score well on efficiency.

**Process — how the agent worked (50%)**

| Dimension | Weight | Gist |
|---|---|---|
| Setup Friction | 12% | penalize interruptions + provider errors |
| Setup Speed | 12% | active tool time vs. 60s ideal |
| Efficiency | 12% | waste = dup reads + errors + overwrites + interruptions |
| Error Recovery | 7% | penalize provider errors |
| Docs Quality | 7% | valid doc URLs, no error, no rewrite-after-fetch |

**Output — what the agent produced (50%)**

| Dimension | Weight | Gist |
|---|---|---|
| Correctness | 25% | L1/L4/L5 grader pass rate (excludes L2/L3) |
| Hallucination | 15% | L2 grader pass rate |
| Security | 10% | L3 grader pass rate |

**Letter grades:** A ≥ 90 · B ≥ 75 · C ≥ 60 · D ≥ 40 · F < 40

> This is a summary. Decision rationale: [`docs/SCORING_METHODOLOGY.md`](SCORING_METHODOLOGY.md).

## Recommendations — turning scores into fixes

Scores diagnose; **recommendations prescribe** — the "every score must point to a fix" principle, in code.

When a run had **skills or MCP enabled**, `generateRunRecommendations` hands the judge LLM the full run context (task, workspace output, injected skill content, grader results, scoring dimensions, efficiency breakdown) and gets back structured JSON: a `severity`-ranked list of fixes, each targeting one of four things to improve.

| Category | What it flags | Example |
|---|---|---|
| `grader` | Missing checks, false pos/neg, over-strict criteria | "L4 grader misses the `audience` config key" |
| `skill` | Skill doc gaps, confusing or outdated instructions | "SKILL.md omits the `cacheLocation` option" |
| `mcp` | Missing MCP tools, unhelpful responses, poor tool UX | "Add a `get_quickstart` tool returning the canonical snippet" |
| `efficiency` | Thrashing that better docs/tools would prevent | "Agent retried the redirect-URI config 3× — document it" |

Recommendations are scoped to **custom** skills/MCP tools (never the agent's built-in tools), then persisted alongside scores and surfaced in the leaderboard. The step is safe by construction: it never throws (returns `undefined` on failure) and strips `.env*` from the prompt.

## Sandbox — running untrusted agent code safely

By default each job runs inside a hardened, ephemeral **Docker sandbox**. The container starts as root only long enough for the entrypoint (`docker/entrypoint.sh`) to apply network rules, then drops to an unprivileged user before any agent code runs. `cli/sandbox-runner.ts` scores and generates recommendations **inside** the box and writes `.eval-results.json`, so the host only reads the JSON back — agent output never executes on the host.

| Control | How it's enforced |
|---|---|
| **Network fail-closed** | `iptables` default-DROP on INPUT/OUTPUT/FORWARD; only established/related, loopback, and explicit DNS are allowed (`entrypoint.sh`). |
| **Read-only code** | `chmod -R a-w /app/node_modules /app/packages /app/apps` in the image — the agent can't mutate framework code (`docker/Dockerfile`). |
| **Validated mount** | The workspace mount is checked to live under the OS temp dir (`realpathSync(tmpdir())`) to prevent mounting arbitrary host paths (`sandbox/docker.ts`). |
| **Dropped privileges** | Runs as UID 1000 (`node`) with `--cap-drop=ALL` and `setpriv --inh-caps=-all`, so the process holds zero capabilities. |

`--dangerously-skip-sandbox` runs directly on the host instead (debugging only).

## Framework vs. consumer

The **framework** ([auth0/auth0-evals](https://github.com/auth0/auth0-evals)) — the engine, graders, runners, and eval suite — is environment-agnostic. A **consumer** supplies only two things to run it: a settings file (`eval.config.js` — which models, docs MCP server, and skills to use) and a credential — either `LLM_API_KEY` in the env, or `proxy.authHeader` plus its token var for a proxy that authenticates on its own header (`LLM_API_KEY` wins when both are present). Everything environment-specific lives in the consumer, so the framework stays clean and behaves identically wherever it runs.

| Consumer | What it is |
|---|---|
| **Laptop** | Clone + `npm install`, point `eval.config.js` at the models you want, put `LLM_API_KEY` in `.env`, run `npm run evals -- --eval <id> …`, then `npm run report`. For developing and spot-checking. |
| **CI pipeline** | A thin wrapper that **pins a framework version** (reproducible runs), **builds once** and shares `dist/` across workers, **fans out the full matrix** as sandboxed jobs, and **merges** every `scores-*.json` into one leaderboard. |

