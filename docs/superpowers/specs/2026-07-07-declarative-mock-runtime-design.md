# Design: declarative mock runtime (manifest + generator + test harness)

**Date:** 2026-07-07
**Status:** proposed

## Problem

The mock Auth0 CLI works, but authoring a route is shell: hand-quoted JSON in
single-quoted strings (with quote-breaks to interpolate state), case-glob
matching, and a repeated "if state then list-with-item else empty" pattern. At
~2 route files it's tolerable. At the **~10 features** this will serve (each with
a CLI + Terraform leg, many authors), the dominant costs become:

- **Cold-start per author** — every new author re-learns `emit`/`has_state`/`$ROUTE`/glob rules.
- **Hand-quoted JSON errors** — ~50 JSON blobs across 10 files, each debugged by running a full eval.
- **Inconsistency drift** — freehand shell across many authors → divergent dialects (state namespacing, URL-form handling).
- **No fast feedback** — testing a route means spawning a full eval (minutes, cost).

Analysis of the existing routes shows ~90% are one of three shapes — **create**
(record state, return body), **reflect** (present ⇒ item, absent ⇒ empty), and
**static** (fixed body). Only ~10% need computed fields (e.g. `GET guardian/factors`
flips each factor's `enabled` per-state; `GET actions` computes `deployed`).

## Goal

Make the 90% **declarative and hard to get wrong** (data, not code), keep the 10%
in a **typed, unit-testable handler**, and give authors a **generator** and a
**local test harness** so a new feature's mock is fast to write and verify
without running an eval.

## Decision

1. **JS interpreter.** The `auth0` binary becomes a thin compiled JS entrypoint. A shell interpreter can't parse JSON/YAML natively (no guaranteed `jq`), which would force the manifest back into fragile shell-ish syntax and lose validation — so declarative-data-manifest implies a JS reader.
2. **JSON manifest per feature** (`<feature>.routes.json`) — schema-validated, verb-based. The 90% case; zero code.
3. **JSON fixtures** for response bodies — real `.json` files, editor-validated, no hand-quoting.
4. **Typed handler escape hatch** (`<feature>.handlers.ts`) for computed responses — a `(ctx) => object` function, unit-testable by import.
5. **Generator + test harness** — `mock:new <feature>` scaffolds; `mock:check <feature>` exercises routes in-process (no eval, no cost).

## Architecture

### Engine vs content (keeps eval-core Auth0-agnostic)

The interpreter is **generic** — "match route → apply state verb → return body or
call handler." It knows nothing about Auth0. Auth0 specifics (the binary name
`auth0`, the `/api/v2` path normalization, guardian/token-exchange manifests)
are **content/config** supplied by the app. So the engine can live as a reusable
module; `eval-core` still only forwards the `EVAL_MOCK_*` env vars.

```
packages/eval-core/src/mock/            # GENERIC engine (no Auth0 knowledge)
  dispatcher.ts                         # parse argv, normalize (configurable), route, respond
  manifest.ts                           # load + schema-validate *.routes.json
  state.ts                              # marker-file state under EVAL_MOCK_STATE_DIR
  verbs.ts                              # create / set / reflect / static
  types.ts                              # RouteManifest, HandlerContext, ...

apps/auth0-evals/mocks/
  auth0                                 # thin entrypoint: #!/usr/bin/env node → runs the engine
                                        #   with Auth0 config (binary=auth0, normalize=/api/v2)
  <feature>.routes.json                 # app-level shared manifests (optional)
  fixtures/<feature>/*.json             # response bodies
  <feature>.handlers.ts                 # computed-field handlers (optional)

apps/auth0-evals/src/evals/<eval>/mock/ # OPTIONAL per-eval, discovered via EVAL_MOCK_ROUTES_DIRS
  <feature>.routes.json
  fixtures/... , handlers.ts
```

### Manifest schema (`*.routes.json`)

```jsonc
{
  "surface": "token-exchange",           // doc/name only
  "consumedBy": ["cte_tenant_cli"],      // provenance, like today's header
  "routes": [
    { "match": "POST actions",           "verb": "create",  "state": "cte.action",   "body": "action.json" },
    { "match": "POST actions/*/deploy",  "verb": "set",     "state": "cte.deployed", "body": { "deployed": true } },
    { "match": "GET actions",            "verb": "reflect", "state": "cte.action",   "present": "actions.json", "absent": { "actions": [] } },
    { "match": "GET token-exchange-profiles", "verb": "handler", "handler": "listProfiles" }
  ]
}
```

- **`match`** — `"<METHOD> <path>"`, path is the *normalized* form; `*` is a single-segment wildcard (compiled to a safe matcher, not a raw glob).
- **verbs:**
  - `create` — record `state`, return `body`.
  - `set` — record `state`, return `body` (semantically "mutate", same mechanics; distinct verb for readability).
  - `reflect` — if `state` present return `present`, else `absent`.
  - `static` — always return `body`.
  - `handler` — call the named export in `<feature>.handlers.ts`.
- **`body`/`present`/`absent`** — either an inline object or a fixture filename (resolved under `fixtures/<surface>/`).
- **state keys** are dotted + namespaced (`cte.action`) — the loader rejects un-namespaced keys to prevent cross-feature collisions.
- Unmatched requests keep today's fallthrough (write ⇒ `{"ok":true}`, read ⇒ `{}`).

### Handler contract (`<feature>.handlers.ts`)

```ts
import type { HandlerContext } from '@a0/eval-core/mock';
export function listProfiles(ctx: HandlerContext): unknown {
  return ctx.state.has('cte.tep')
    ? { token_exchange_profiles: [{ id: 'tep_legacy', /* … */ }] }
    : { token_exchange_profiles: [] };
}
```

`HandlerContext` = `{ method, path, payload, state: { has, set, clear } }`. Handler
returns a JS object; the engine serializes it. Directly unit-testable — no
subprocess, no `EVAL_MOCK_STATE_DIR` setup (inject a fake `state`).

### Execution & state

- Entrypoint resolves manifests from the app `mocks/` dir plus any `EVAL_MOCK_ROUTES_DIRS` (per-eval), same discovery order as today.
- State stays **marker files under `EVAL_MOCK_STATE_DIR`** (unchanged model; the shell and JS engines are interchangeable at the state layer, easing migration).
- Handlers are loaded from compiled JS at runtime. Per-eval handlers ship as `.ts` and are compiled by the app build (they live under `src/evals`, already in the TS project); the dispatcher imports the compiled `dist` path, mirroring how `graders.ts` is loaded.

### Generator & test harness

- `npm run mock:new <surface>` → scaffolds `<surface>.routes.json` (with a create/reflect/static example), `fixtures/<surface>/`, a `handlers.ts` stub, and a `<surface>.mock.test.ts`.
- `npm run mock:check <surface>` → loads the manifest in-process and runs a set of `METHOD path` probes, printing responses and state transitions. No eval, no LLM, no cost. Also runnable as a vitest that asserts every `fixture`/`handler` reference resolves and every manifest validates against the schema.

## Migration

1. Build the engine + entrypoint; keep the **shell dispatcher working** until parity is proven.
2. Port `guardian` and `token-exchange` to manifests + one handler each (the computed cases). Assert the existing route tests (`guardian-route.test.ts`, `token-exchange-route.test.ts`) still pass unchanged against the new entrypoint — same observable behavior.
3. Delete the shell dispatcher + `lib.sh` once parity holds.
4. Update `mocks/README.md` + `routes/README.md` to the manifest contract.

Because behavior is verified against the *existing* black-box route tests, the migration is provably behavior-preserving.

## Components

| Area | Change |
| --- | --- |
| `packages/eval-core/src/mock/*` | New generic engine (dispatcher, manifest loader+schema, state, verbs, types). No Auth0 knowledge. |
| `apps/auth0-evals/mocks/auth0` | Replace shell dispatcher with a thin JS entrypoint that runs the engine with Auth0 config. |
| `apps/auth0-evals/mocks/*.routes.json` + `fixtures/**` + `*.handlers.ts` | Ported guardian + token-exchange. |
| `packages/eval/src/cli` (or app scripts) | `mock:new`, `mock:check` commands. |
| tests | Engine unit tests (verbs, matcher, state, fallthrough); handler unit tests; schema-validation test; existing route tests pass unchanged. |
| `docker/*` | Entrypoint already runs node; ensure the JS `auth0` is executable (`#!/usr/bin/env node`) and compiled assets are copied. |
| docs | `mocks/README.md`, `routes/README.md`, `docs/ADDING_EVALS.md` (mock section). |

## Tradeoffs accepted

- **~50ms Node cold-start per `auth0` call** (vs ~2ms shell). At ~15 calls/eval that's <1s on minute-long runs. Acceptable; if it ever bites, mitigate with a persistent mock server the entrypoint calls — deferred (YAGNI).
- **A build step for the interpreter + handlers.** Authors still never write JS for the 90% case; only the ~10% computed handlers are TS, and those live in the already-compiled TS project.
- **A schema/mini-DSL to learn.** Mitigated by the generator (start from a working example) and schema validation (errors caught at load, not mid-eval).

## Non-goals

- Not a general HTTP mock server; scope is the `auth0 api <method> <path>` CLI shape.
- Not request-body assertion for graders — graders still read the tool-call trace.
- Not removing per-feature ownership — manifests/handlers/fixtures still ship in the feature's PR (app-level or per-eval).

## Resolved decisions

- **JSON manifest** (not YAML) — zero dependency, schema-validatable out of the box, smoothed by the generator.
- **Lands in the existing stack**, not a separate PR: the engine goes in the **plumbing** branch (#82); the **MFA** (#83) and **CTE** (#84) branches replace their `guardian.sh` / `token-exchange.sh` with `*.routes.json` + fixtures + handler, showing how a feature consumes the engine.

## Open questions

- **Per-eval handler compilation.** Confirm the app build compiles `src/evals/<eval>/mock/handlers.ts` to a `dist` path the entrypoint can import, exactly like `graders.ts`. If not, per-eval routes stay manifest-only (no handler) and computed cases live in app-level `mocks/`. (Not blocking — current guardian/token-exchange handlers live app-level.)
