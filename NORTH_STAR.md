# Evolution Plan: auth0-evals as the North Star for Agentic SDK Experience

## Context

auth0-evals currently evaluates 13 quickstart integrations using static file analysis (text search + LLM judge). To become the **primary entrypoint** for understanding agentic SDK experience across all Auth0 features, it needs: richer grading (events, file-scoped, runtime), the ability to verify running applications (Playwright), feature-level evals beyond quickstarts, and production-ready infrastructure with regression detection.

All changes are **backward-compatible** — existing 13 evals work unchanged throughout.

---

## Phase 1: Foundation Hardening

**Goal:** Extensible grader pipeline, event-based graders, file-scoped graders, production-ready ReAct agent.

### 1.1 Grader Executor Registry

Refactor grader execution from monolithic `runGraders()` to a pluggable dispatcher:

```typescript
// NEW: packages/eval/src/graders/executor.ts
export interface GraderExecutor {
  kind: string;
  execute(def: GraderDef, context: GraderContext): Promise<GraderResult>;
}

export interface GraderContext {
  workspace: string;
  files: Record<string, string>;       // workspace file contents
  toolCalls?: EventToolCall[];         // agent behavior trace
  runRecord?: RunRecord;
  apiKey: string;
}
```

Register executors at startup: `text-search`, `llm-judge`, `event-based`, `file-scoped`. Each handles its own `kind` values.

### 1.2 Merge Event-Based Graders (from `feat/event-based-graders`)

8 primitives that grade agent *behavior* via tool call trace:

| Primitive | Purpose |
|-----------|---------|
| `ranCommand(cmd, args?)` | Agent ran a shell command |
| `ranCommandOneOf(cmds)` | Agent ran one of N alternatives |
| `didNotRunCommand(cmd)` | Agent did NOT run a command |
| `usedTool(name)` | Agent used a specific tool |
| `toolCalledWithArg(tool, key, value)` | Tool called with specific arg |
| `wroteFile(path)` | Agent wrote a file matching path |
| `fetchedUrl(pattern)` | Agent fetched a URL |
| `eventMatch(predicate)` | Custom predicate (escape hatch) |

Already implemented on branch — merge, add executor, wire into pipeline.

### 1.3 File-Scoped Graders (NEW)

Assertions scoped to specific files (not the entire workspace):

```typescript
fileContains(pathPattern: string, needle: string, desc?, level?)
fileMatches(pathPattern: string, regex: string, desc?, level?)
fileNotContains(pathPattern: string, needle: string, desc?, level?)
```

`pathPattern` is a glob or substring match against relative file paths. Allows precise grading like "check that `src/App.tsx` contains `Auth0Provider`" without false positives from other files.

### 1.4 ReAct Agent Production Hardening

- **Structured error types:** `RATE_LIMITED`, `TIMEOUT`, `TOOL_EXECUTION_ERROR`, `LLM_MALFORMED_RESPONSE`, `AGENT_LOOP_EXHAUSTED`
- **Configurable retry:** Exponential backoff per error category, max retries per turn
- **Structured logging:** Turn number, tool name, error category, timing, cost
- **AgentConfig:** `maxTurns`, `maxRetries`, `toolTimeoutMs`, `maxTotalCostUsd`
- **Graceful degradation:** Exhaust retries → mark status, don't crash

### Files Changed (Phase 1)

| File | Change |
|------|--------|
| `packages/eval-graders/src/types.ts` | Add `EventToolCall`, `predicate` to GraderDef |
| `packages/eval-graders/src/primitives.ts` | Add event + file primitives |
| `packages/eval-graders/src/index.ts` | Export new primitives |
| `packages/eval/src/graders/executor.ts` | NEW — executor registry |
| `packages/eval/src/graders/executors/*.ts` | NEW — 4 executor implementations |
| `packages/eval-react-runner/src/errors.ts` | NEW — structured error types |
| `packages/eval-react-runner/src/agent.ts` | Retry logic, structured logging, config |
| `apps/auth0-evals/src/agent_eval/graders.ts` | Refactor to use executor registry |

---

## Phase 2: Runtime Graders (Playwright)

**Goal:** Verify agent-built apps actually work by building, serving, and testing them with Playwright.

### 2.1 Extended Workspace Lifecycle

```
SETUP → AGENT_RUN → BUILD → SERVE → GRADE (static + runtime) → CLEANUP
```

New lifecycle phases are **opt-in** per eval via PROMPT.md frontmatter:

```yaml
---
skills: auth0-react
setup_command: npm install
build_command: npm run build
dev_server_command: npm run dev
dev_server_port: 3000
dev_server_ready_pattern: "ready on"
runtime_timeout: 30000
---
```

### 2.2 Runtime Grader Primitives

```typescript
// Verify app serves and returns 200
appRenders(path?: string, desc?, level?)

// Verify unauthenticated access redirects to login
routeProtected(path: string, desc?, level?)

// Run a named Playwright test file
playwrightTest(testPath: string, desc?, level?)

// Assert DOM element exists with content
domContains(selector: string, text?: string, desc?, level?)

// Assert network request was made
networkCallMade(urlPattern: string, desc?, level?)

// Custom Playwright script (escape hatch)
runtimeCheck(script: (page: Page) => Promise<boolean>, desc: string, level?)
```

### 2.3 Runtime Executor

The `runtime` executor:
1. Builds the workspace app (`build_command`)
2. Starts dev server (`dev_server_command`) with port detection
3. Waits for ready signal (`dev_server_ready_pattern` in stdout)
4. Executes runtime grader assertions via Playwright
5. Stops server and cleans up

Server lifecycle is shared across all runtime graders in one eval (start once, grade many).

### 2.4 Scoring Integration

Runtime graders contribute to **L4 (structural)** score — they verify correct wiring at a deeper level than static analysis. No new dimension needed; runtime just makes L4 grading more powerful.

Alternative: Optional 8th dimension **Runtime Correctness** (5%) that only activates when runtime graders are present. Weights redistribute from Correctness (25% → 20%).

### 2.5 New Package Dependency

Add `@playwright/test` as optional peer dep of `@a0/eval`. Runtime executor lazily imports it — evals without runtime graders never load Playwright.

### Files Changed (Phase 2)

| File | Change |
|------|--------|
| `packages/eval-graders/src/primitives.ts` | Add runtime primitives |
| `packages/eval/src/workspace/lifecycle.ts` | NEW — build/serve/cleanup orchestration |
| `packages/eval/src/graders/executors/runtime.ts` | NEW — Playwright-based executor |
| `packages/eval/src/loader.ts` | Parse runtime frontmatter fields |
| `packages/eval/src/types/eval.ts` | Add runtime config to EvalDefinition |
| `apps/auth0-evals/src/run.ts` | Integrate runtime phase |
| `packages/eval/package.json` | Add @playwright/test as optional peer |

---

## Phase 3: Feature-Level Evals

**Goal:** Evaluate SDK features beyond quickstarts — RBAC, Organizations, MFA, Actions, API protection.

### 3.1 Eval Category Expansion

```
src/evals/
  quickstarts/         (existing 13 — unchanged)
  features/
    rbac/react/
    rbac/express/
    organizations/react/
    mfa/react/
    actions/express/
    api-protection/express-api/
```

### 3.2 Feature Eval Design Pattern

| Aspect | Quickstart | Feature Eval |
|--------|-----------|--------------|
| Scaffold | Minimal starter | Pre-configured app with auth working |
| Prompt | "Add Auth0 login" | "Add RBAC to your already-authenticated app" |
| Agent task | Build from scratch | Add feature on top |
| Grader focus | SDK basics (L1-L3) | Feature correctness (L4-L5) |
| Complexity | Beginner | Intermediate/Advanced |

### 3.3 Feature Eval Scaffolds

Each feature eval scaffold includes a **working Auth0 app** (login/logout already functional). The agent's job is to add the specific feature:

```
features/rbac/react/scaffold/
  src/App.tsx              ← Auth0Provider configured, login works
  src/components/Profile.tsx ← Shows user info (working)
  src/components/Admin.tsx   ← Empty, agent fills in RBAC logic
  .env.example             ← Template with domain/clientId
  package.json             ← All deps including @auth0/auth0-react
```

### 3.4 EvalConfig Extension

```typescript
export interface EvalConfig {
  id: string;
  name: string;
  category: string;              // 'quickstarts' | 'features'
  path: string;
  tags?: string[];               // ['frontend', 'authorization', 'rbac']
  framework?: string;            // 'react', 'express', 'nextjs'
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}
```

### 3.5 CLI Filtering

```bash
npm run run -- --category features                    # All feature evals
npm run run -- --category features --tag rbac         # RBAC evals only
npm run run -- --framework react                      # All React evals
npm run run -- --difficulty advanced                   # Advanced only
```

### Files Changed (Phase 3)

| File | Change |
|------|--------|
| `apps/auth0-evals/src/config/evaluations.ts` | Extend EvalConfig, register feature evals |
| `apps/auth0-evals/src/evals/features/` | NEW — all feature eval directories |
| `apps/auth0-evals/src/cli/config.ts` | Parse --category, --tag, --framework, --difficulty |
| `apps/auth0-evals/src/run.ts` | Filter job list by category/tag/framework |

---

## Phase 4: Insights & Regression Detection

**Goal:** Historical tracking, regression alerts, per-SDK health scores, CI gates.

### 4.1 Results Persistence

```
results-history/
  2026-05-04/results.json
  2026-05-05/results.json
  index.json              ← metadata (dates, models, eval counts)
```

After each run, optionally archive results with `--archive` flag.

### 4.2 Regression Detection

```typescript
// packages/eval-reporter/src/trending.ts
export interface RegressionAlert {
  evalId: string;
  model: string;
  mode: string;
  dimension: string;
  previousScore: number;
  currentScore: number;
  delta: number;
  severity: 'warning' | 'critical';  // -5 warning, -10 critical
}

export function detectRegressions(
  current: JobResult[],
  historical: JobResult[],
  threshold: number
): RegressionAlert[];
```

### 4.3 SDK Health Dashboard

Aggregate scores by SDK across all evals that use it:

```typescript
export interface SDKHealth {
  sdk: string;               // '@auth0/auth0-react'
  avgScore: number;
  passRate: number;          // % evals scoring A/B
  trend: 'improving' | 'stable' | 'declining';
  weakestDimension: string;  // actionable insight
  regressions: number;       // count in last 7 days
}
```

### 4.4 CI Gate

```bash
# Fail CI if >3 critical regressions
npm run report -- --regressions --threshold -10 --fail-on 3
```

### 4.5 Enhanced HTML Report

- Trend sparklines per eval/model
- Regression alerts panel
- SDK health cards
- Filter by category, model, time range

### Files Changed (Phase 4)

| File | Change |
|------|--------|
| `packages/eval-reporter/src/trending.ts` | NEW — history loading, regression detection |
| `packages/eval-reporter/src/health.ts` | NEW — SDK health aggregation |
| `packages/eval-reporter/src/report.ts` | Add trending/health sections to HTML |
| `apps/auth0-evals/src/cli/report.ts` | New flags: --regressions, --health, --archive |
| `.github/workflows/evals.yml` | Archive + regression gate step |

---

## Implementation Order & Dependencies

```
Phase 1.1 (Executor Registry) ──┐
Phase 1.2 (Event Graders)  ─────┼──→ Phase 2 (Runtime) ──→ Phase 4 (Insights)
Phase 1.3 (File Graders)   ─────┘         ↓
Phase 1.4 (ReAct Hardening) ─────────→ Phase 3 (Features)
```

Phases 3 and 4 are **independent of each other** and can run in parallel once Phase 1+2 are done. Phase 3 can even start after Phase 1 alone (feature evals don't require runtime graders initially).

---

## Verification Strategy

After each phase:
1. `npm run build && npm test` — all existing tests pass
2. `/evals-smoke-test` — existing 13 quickstart evals produce valid scores
3. Phase-specific validation:
   - **Phase 1:** Write one eval using event graders + file graders, verify scoring works
   - **Phase 2:** Write one eval with runtime graders, verify Playwright executes
   - **Phase 3:** Write 2-3 feature evals, verify category filtering works
   - **Phase 4:** Run twice, verify regression detection identifies score changes
