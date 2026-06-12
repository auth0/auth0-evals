# Runtime (Playwright) Grader — Design

**Date:** 2026-06-12
**Status:** Approved (brainstorming) — ready for implementation plan
**Scope of first slice:** Mechanism complete; wired to `react_quickstart` only.

## Summary

Today's evals grade static artifacts (source text, regex, LLM judge) plus a few
event-based checks against the agent's tool-call trace. This feature adds a third
class: **runtime grading** — spin up the application the agent built, drive it
with a headless browser (Playwright), perform a real Auth0 login against a
dedicated test tenant, and assert the app reaches a logged-in state.

This first increment builds the full mechanism but wires it to a single eval
(`react_quickstart`) as a proving ground. Future enterprise/advanced evals that
require integration with a real Auth0 tenant will reuse this mechanism.

## Goals

- Execute the agent's built app and verify a real end-to-end login works.
- Keep the change small and isolated: one new grader kind, no scoring-model changes.
- Run inside the Docker sandbox when sandboxed; on the host when `--dangerously-skip-sandbox`.
- Never corrupt existing static/event grading.

## Non-goals (this slice)

- Automated per-run tenant/app provisioning via the Management API (manual setup instead).
- Wiring runtime grading to evals other than `react_quickstart`.
- A declarative step DSL or a reusable login helper (per-eval Playwright scripts instead).
- A new scoring dimension (runtime reuses the existing L4 → Correctness path).

## Key decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Tenant model | Dedicated test tenant; real creds via `.env` | Realistic, low ongoing cost, no per-run provisioning. |
| Credential reconciliation | String-swap fake→real before launch | Works regardless of how the agent wired creds. |
| Grading fit | New grader kind, **reuse L4** | No new level enum; flows into Correctness like other L4 graders. |
| Step authoring | Per-eval Playwright script | Maximum flexibility; Universal Login selectors live in the script. |
| App startup | Frontmatter `serve_command` + `serve_port` | Deterministic, eval-author controlled; enables pre-registering callback URL. |
| Selector strategy | Prompt mandates `data-testid`s | Deterministic; following the instruction is itself gradeable. |
| Execution env | Sandbox container (Docker) / host (skip-sandbox) | Mirrors how the agent itself already runs in both modes. |
| Runtime structure | **A: self-contained grader** | One grader = one runtime session; smallest blast radius. |
| Missing prereqs | **Hard fail** | Runtime grader is always part of `react_quickstart` and fails without creds/browser. |
| First scope | Mechanism + `react_quickstart` only | Careful first vertical slice. |

## Architecture

A new self-contained grader kind, `runtime`, tagged **L4**, runs as the **final**
grader for `react_quickstart`. It executes after all static/event graders so the
credential swap never corrupts the static checks (which verify the agent wired the
prompt's **fake** values).

### Execution seam

Both run paths already call `runGraders` after the agent finishes, with the
workspace intact:

- Docker: `packages/eval/src/cli/sandbox-runner.ts:114`
- Host: `packages/eval/src/cli/run.ts:167`

The runtime grader is just another entry in the grader list (ordered last). No new
orchestration phase is introduced.

### Runtime session (owned by the executor)

```
1. Verify prerequisites  → real test-tenant creds (env) + Chromium present.
                           Missing → grader FAILS (hard).
2. Swap credentials      → in a THROWAWAY COPY of the workspace, replace known fake
                           values with real ones from env.
3. Install + serve       → run setup_command if needed, then serve_command;
                           wait for serve_port to accept TCP (bounded timeout).
4. Drive with Playwright → launch headless Chromium; invoke the eval's playwright.ts
                           default export with { page, baseURL, testUser }.
5. Assert + teardown     → script returns pass/fail + detail; always (finally)
                           kill server, close browser, rm -rf the copy.
```

**Why a throwaway copy, not in-place mutation:** keeps the graded artifact honest
(fake creds as authored, which is what static graders saw and what gets reported),
prevents real creds leaking into reported/kept workspaces, and makes teardown a
simple `rm -rf`. The original workspace is never mutated by runtime grading.

### Where it runs

- **Docker mode**: inside the existing sandbox container (Chromium + Playwright
  added to the image). The entrypoint network rules already allow loopback (dev
  server) and public internet (real Auth0) — no iptables change.
- **`--dangerously-skip-sandbox`**: on the host via the same executor code path,
  relying on a locally-installed Chromium.

## Eval authoring surface

Three additions to a runtime-enabled eval (scoped to `react_quickstart` here):

### 1. PROMPT.md frontmatter (additive; flat key:value)

```
serve_command: npm run dev
serve_port: 5173
runtime_swap: dev-barkbook.us.auth0.com=$RUNTIME_AUTH0_DOMAIN, barkbook_client_abc123xyz=$RUNTIME_AUTH0_CLIENT_ID, https://api.barkbook.com=$RUNTIME_AUTH0_AUDIENCE
```

- `serve_command` / `serve_port` flow into `EvalDefinition` as new optional fields
  (`serveCommand?`, `servePort?`).
- `runtime_swap` is a comma-separated list of `fakeValue=$ENV_VAR` pairs. The fake
  values are fixed strings owned by the eval; declaring them explicitly avoids
  guessing. The executor resolves `$ENV_VAR` from `process.env` and does a literal
  string replace of each fake→real across all text files in the copy.
- The existing `parseFrontmatter` passes unknown keys through in `meta`, so this is
  purely additive.

### 2. PROMPT.md task text — mandate test IDs

> Add `data-testid="login"` to the login button, `data-testid="logout"` to the
> logout button, and `data-testid="profile"` to the element showing the user's name.

This is also gradeable via static L1 `contains('data-testid="login"')` checks,
independent of the runtime session.

### 3. playwright.ts (new file beside PROMPT.md + graders.ts)

```typescript
export default async function run(
  { page, baseURL, testUser }: RuntimeContext,
): Promise<RuntimeOutcome> {
  await page.goto(baseURL);
  await page.getByTestId('login').click();
  // Universal Login (real Auth0 tenant) — selectors are the eval author's responsibility
  await page.fill('input[name="username"]', testUser.email);
  await page.fill('input[name="password"]', testUser.password);
  await page.getByRole('button', { name: /continue|log in/i }).click();
  await page.waitForURL(baseURL + '**');
  await expect(page.getByTestId('profile')).toContainText(testUser.expectedName);
  return { passed: true, detail: 'Logged in; profile visible' };
}
```

`graders.ts` adds one line — a `runtime('./playwright.ts', '...')` grader.

## Credential model

### Env vars (host `.env`, forwarded into the container)

```
RUNTIME_AUTH0_DOMAIN=<real test tenant domain>
RUNTIME_AUTH0_CLIENT_ID=<real SPA client id>
RUNTIME_AUTH0_AUDIENCE=<real API audience>
RUNTIME_TEST_USER_EMAIL=<test user>
RUNTIME_TEST_USER_PASSWORD=<test user password>
RUNTIME_TEST_USER_NAME=<expected display name for the profile assertion>
```

Forwarded into the Docker container the same way `LLM_API_KEY` is today
(`packages/eval/src/sandbox/docker.ts:132`).

### One-time tenant setup (manual, documented — not automated this slice)

A dedicated test tenant with:
- A SPA application whose **Allowed Callback URLs**, **Allowed Logout URLs**, and
  **Allowed Web Origins** include `http://localhost:5173` (the declared `serve_port`).
- One test user with a known password and display name.

Documented in a new `docs/RUNTIME_GRADING.md`.

### Secret hygiene

- The throwaway copy is created **after** static grading and is excluded from any
  file collection — real creds never reach the judge or the graded corpus.
- Real creds live only in the browser session's process env and the throwaway copy.
- `--keep-workspace` keeps the original (fake) workspace, as today. The copy is
  always destroyed in `finally`.

## Code structure & types

### New grader primitive (`packages/eval-graders/src/primitives.ts`)

```typescript
runtime(scriptPath: string, description: string): GraderDef
// → { kind: 'runtime', name, scriptPath, level: GraderLevel.L4 }
```

Requires a new optional field on `GraderDef` (`scriptPath?: string`) in
`packages/eval-graders/src/types.ts`. Level is fixed L4 — no new enum value.

### New executor (`packages/eval-core/src/graders/executors/runtime.ts`)

Registered in `engine.ts` alongside the existing executors. Receives the existing
`GraderContext`, extended with runtime essentials:

```typescript
interface GraderContext {
  // ...existing...
  runtime?: {
    serveCommand?: string;
    servePort?: number;
    swap: Array<{ from: string; to: string }>;   // resolved from env
    testUser: { email: string; password: string; expectedName: string };
    browserAvailable: boolean;
  };
}
```

`runGraders` builds `runtime` from `EvalDefinition` + `process.env`. When real
creds are absent, the executor returns a **failed** `GraderResult` with a clear
detail (e.g. `"runtime grading requires RUNTIME_AUTH0_* env vars"`).

### Executor internals (small, testable units)

- `prepareRuntimeWorkspace(workspace, swap)` → copy + apply swap; returns copy path.
- `startServer(copyPath, serveCommand, servePort)` → spawn, wait for port, return
  handle with `.stop()`.
- `runScript(scriptPath, { page, baseURL, testUser })` → dynamic-import the eval's
  `playwright.ts` (via `pathToFileURL`), invoke default export.
- `runtimeExecutor.execute()` → orchestrate: prereq check → prepare → start →
  launch browser → runScript → map to `GraderResult` → `finally` teardown.

### Playwright dependency

Added to `eval-core` (the package that runs graders). Browser binary installed in
the Docker image; on host it relies on a locally-installed Chromium.

## Docker image

`docker/Dockerfile` runtime stage adds Playwright's Chromium + system libs via
`npx playwright install --with-deps chromium`, with `PLAYWRIGHT_BROWSERS_PATH` set
to a path readable by the dropped `node` user. This grows the image (~400MB+).
Browser runs headless under the existing unprivileged user. No `entrypoint.sh`
iptables change needed (loopback + public internet already allowed).

## Scoring

No scoring-model changes. The runtime grader is L4, so it flows into
**Correctness** exactly like other L4 graders (`packages/eval/src/scorer.ts`
includes L1/L4/L5). L4 runs in agent configurations only, so **baseline runs are
unaffected**.

## Error handling

Every failure maps to a `GraderResult` — never a throw (a throw crashes the grader
loop).

| Failure | Result |
|---|---|
| Missing creds / no browser | `passed: false`; detail names the missing prereq |
| Server didn't bind port within timeout | `passed: false`; detail "serve_command never opened port N" |
| Playwright step threw / assertion failed | `passed: false`; detail = error message |
| Login succeeded, profile visible | `passed: true` |

Server-start and browser-session each have bounded timeouts so a hung app cannot
stall the run. Teardown (kill server, close browser, rm copy) always runs in
`finally`.

## Operational consequence (deliberate)

Because the `runtime` grader is **always** part of `react_quickstart` and **hard-fails**
without creds/browser, and because it is L4 (agent configs only):

> **Every agent-mode run of `react_quickstart` — including `/evals-smoke-test` and
> CI — will fail unless test-tenant creds and a browser are present.**

Mitigation baked into the plan:
- Add `RUNTIME_AUTH0_*` as GH secrets and pass them through to the eval.
- Ensure the Docker image (used by CI/smoke-test) includes Chromium.
- Document in `docs/RUNTIME_GRADING.md` that agent-mode `react_quickstart` requires
  a test tenant.

Baseline runs and all other evals are untouched.

## Testing

Per the repo rule, tests live in each package's `tests/`:

- `packages/eval-graders/tests/`: `runtime()` primitive shape (happy path + edge).
- `packages/eval-core/tests/`:
  - `prepareRuntimeWorkspace` — swap correctness; copy isolation (original
    untouched).
  - prereq-missing → failed `GraderResult`.
  - server-start timeout → failed `GraderResult`.
  - Browser/script invocation mocked — no real Auth0 in unit tests.
- A real end-to-end login is exercised manually / in CI with creds, not in unit tests.

## Docs to update

- **New** `docs/RUNTIME_GRADING.md` — tenant setup, env vars, how runtime grading
  works, CI requirement.
- `AGENTS.md` — grader primitives table (`runtime`), frontmatter fields
  (`serve_command`, `serve_port`, `runtime_swap`), note on the runtime grader kind
  and its L4/agent-config behavior.
- `docs/ADDING_EVALS.md` — `serve_command` / `serve_port` / `runtime_swap`
  frontmatter and the `playwright.ts` file.
- `docker/Dockerfile` — comment explaining the Chromium/Playwright addition.

## Open risks

- **Image size / build time** grows with Chromium. Acceptable for the value;
  flagged for review.
- **Universal Login selector drift** — Auth0's login page markup could change.
  Mitigated by keeping selectors in the per-eval script (easy to update), not
  framework-baked.
- **CI secret management** — requires test-tenant creds available to CI; if a
  contributor PR cannot access secrets, agent-mode `react_quickstart` will fail
  there. Documented as a known constraint of the "always on, fail without creds"
  decision.
