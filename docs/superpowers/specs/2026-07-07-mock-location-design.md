# Design: relocate the mock CLI to the app, keep eval-core Auth0-agnostic

**Date:** 2026-07-07
**Status:** proposed

## Problem

The mock Auth0 CLI lives in a repo-root `mocks/` directory with no clear owner. In a monorepo where everything else is a package (`packages/*`) or the app (`apps/auth0-evals`), a top-level `mocks/` is ambiguous about ownership. The driving concern is **ownership clarity**.

Underneath that sits a layering question: **does `eval-core` need to know about Auth0?** The answer is **no**. `eval-core` is the generic eval framework — it runs agents, loads evals, scores graders, and could in principle evaluate any SDK, not just Auth0. Anything Auth0-specific in it is a layering violation.

Applying the test *"would this exist if we evaluated Stripe/GitHub instead of Auth0?"*:

| Piece | Auth0-specific? | Owner |
| --- | --- | --- |
| `EVAL_MOCK_BIN_DIR` / `EVAL_MOCK_STATE_DIR` PATH+state wiring | No | **eval-core** (already there) |
| The `auth0` dispatcher binary (named `auth0`, normalizes `/api/v2/`) | **Yes** | app |
| `lib.sh` helpers | Mostly generic, but ship with the dispatcher | app |
| `routes/guardian.sh`, `routes/token-exchange.sh` | **Yes** | app / feature |
| Path normalization stripping `/api/v2/` | **Yes** (Auth0 Management API convention) | app |

The dispatcher is named `auth0` and encodes Auth0's Management API path conventions — it is **not** generic. Only the env-var contract ("if given a mock bin dir, prepend it to PATH; forward the state dir") is generic, and that already lives in `eval-core/src/utils/env.ts`.

## Decision

1. **`eval-core` stays Auth0-agnostic.** It keeps only the generic env-var contract in `env.ts`. Nothing moves *into* eval-core. It never learns the mocked CLI is `auth0`.
2. **The entire mock tree moves to the app**: `mocks/` → `apps/auth0-evals/mocks/`. The app that owns the Auth0 evals owns the Auth0 mock. One owner, co-located.
3. **Route files may live in two places** (both discovered by the dispatcher), preserving per-feature ownership:
   - `apps/auth0-evals/mocks/routes/*.sh` — app-level shared surfaces.
   - `apps/auth0-evals/src/evals/<category>/<eval>/routes/*.sh` — **co-located with the eval that owns them**, so a feature's mock ships in the feature's own directory (and PR).

## Architecture

### Ownership split

```
packages/eval-core/src/utils/env.ts     # GENERIC: prepend EVAL_MOCK_BIN_DIR to PATH,
                                         #          forward EVAL_MOCK_STATE_DIR. No Auth0.

apps/auth0-evals/
  mocks/
    auth0                                # dispatcher (Auth0-specific: name + /api/v2 norm)
    lib.sh                               # emit / record_state / has_state / clear_state
    routes/
      README.md                          # route-file contract
      <surface>.sh                       # app-level shared routes (optional)
  src/evals/<category>/<eval>/
    PROMPT.md
    graders.ts
    routes/<surface>.sh                  # OPTIONAL: routes owned by this eval
```

### Route discovery

The dispatcher sources route files from, in order:

1. its own `mocks/routes/*.sh` (app-level), then
2. every directory named on `EVAL_MOCK_ROUTES_DIRS` (colon-separated), which the runner populates with the active eval's `routes/` dir when one exists.

Discovery stops at the first route file that handles the request (`HANDLED=1`); if none match, the existing fallthrough applies (unmapped writes → `{"ok":true}`, reads → `{}`). Route files remain named by API surface and namespace their own state keys.

The runner (`run.ts` / `entrypoint.sh`) computes the per-eval routes dir from the eval's resolved path and exports `EVAL_MOCK_ROUTES_DIRS` alongside the existing `EVAL_MOCK_*` vars. If unset, the dispatcher just uses its own `routes/` — fully backward compatible.

### Path resolution (removes the `..` walk)

`run.ts` currently anchors the mock dir with `join(__dirname, '..','..','..','..','mocks')` — a fragile 4-level walk from `packages/eval/dist/cli/`. Since the runner already uses `process.cwd()` as `frameworkRoot` (the tool runs from inside `apps/auth0-evals`, which is why `evalsDir` is the relative `src/evals`), the mock dir becomes:

```
EVAL_MOCK_BIN_DIR = join(frameworkRoot, 'mocks')   // = apps/auth0-evals/mocks
```

App-relative, no `..` counting, breaks if neither the package layout nor build depth changes.

### Docker

`docker/Dockerfile` changes `COPY mocks/ /app/mocks/` → `COPY apps/auth0-evals/mocks/ /app/mocks/`. `entrypoint.sh` keeps `EVAL_MOCK_BIN_DIR=/app/mocks` unchanged, and additionally exports `EVAL_MOCK_ROUTES_DIRS` for the eval it runs (single-eval-per-container, so at most one per-eval routes dir). The `chmod +x` on the copied stubs is unchanged.

## Components changed

| File | Change |
| --- | --- |
| `apps/auth0-evals/mocks/**` | New location (moved from repo-root `mocks/`). |
| `packages/eval/src/cli/run.ts` | Anchor `EVAL_MOCK_BIN_DIR` to `frameworkRoot/mocks`; export `EVAL_MOCK_ROUTES_DIRS` for the active eval when it has a `routes/` dir. |
| `apps/auth0-evals/mocks/auth0` | Dispatcher also sources `EVAL_MOCK_ROUTES_DIRS` dirs after its own `routes/`. |
| `docker/Dockerfile`, `docker/entrypoint.sh` | Copy from `apps/auth0-evals/mocks/`; export per-eval routes dir. |
| `packages/eval-core/src/utils/env.ts` | Forward `EVAL_MOCK_ROUTES_DIRS` (same pattern as the other two vars). No Auth0 knowledge added. |
| `packages/eval-core/src/graders/engine.ts` | Add `routes` to `EXCLUDED_EVAL_DIRS` (guardrail 1). |
| `packages/eval-core/src/graders/executors/llm-judge.ts` | Exclude `*.sh` under a `routes/` path from judge input (guardrail 2). |
| tests | Update the mock-path anchor in `auth0-mock.test.ts` to the new location; test per-eval `routes/` discovery; test a co-located `routes/` dir never appears in `collectFiles(workspace)` (guardrail 3). |
| `mocks/README.md`, `routes/README.md` | Document the new location + per-eval route option + the exclusion guardrails. |

## What does NOT change

- `eval-core` gains **zero** Auth0 knowledge — it only forwards env vars.
- The dispatcher/route/`lib.sh` mechanics (normalization, `emit`, state helpers, fallthrough, per-feature self-containment) are unchanged.
- Grading exclusions: the state dir stays outside the workspace; route files under `src/evals/.../routes/` must be excluded from the grading corpus (add to exclusions if not already covered by the scaffold-copy boundary).

## Testing

- **Path anchor:** a test asserting the runner resolves `EVAL_MOCK_BIN_DIR` to `<frameworkRoot>/mocks`.
- **Per-eval discovery:** dispatcher test with a throwaway eval `routes/` dir on `EVAL_MOCK_ROUTES_DIRS`, asserting its route is sourced and can be overridden/fall through.
- **Regression:** existing dispatcher + guardian + token-exchange route tests pass from the new location.
- **Grading corpus:** a test (or exclusion check) confirming a co-located `routes/` dir is never graded.

## Safety of co-located per-eval `routes/` (verified)

Per-eval route files live under `src/evals/<eval>/routes/` (CLI evals only — terraform/client evals have none). They cannot leak into grading or the agent, by construction:

- **Agent context:** the workspace is populated *only* from the eval's `scaffold` path (`loadScaffold`), never from the eval source dir. A `routes/` dir is not the scaffold, so it is never copied into the workspace — the agent cannot see it.
- **Grader corpus:** `collectFiles(workspace)` reads from the *workspace*, not the source dir. Not in the workspace ⇒ not graded.
- **LLM judge:** reads the workspace corpus (`ctx.files`) minus exclusions. Same boundary applies.

**Defense-in-depth guardrails** (added even though the boundary already prevents leakage, so a future refactor can't silently break it):

1. Add `routes` to `EXCLUDED_EVAL_DIRS` — if a `routes/` dir ever reaches a workspace, grading and scoring skip it.
2. Add mock shell scripts (`*.sh` under a `routes/` path) to `JUDGE_EXCLUDED_PATTERNS` — the judge never ingests route scripts.
3. Add a test asserting a co-located `routes/` dir never appears in `collectFiles(workspace)` — locks the invariant; a regression fails loudly.

These are one-line additions to existing exclusion sets plus one test. The per-eval routes option therefore ships as designed (no fallback needed).
