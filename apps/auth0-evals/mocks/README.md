# Mock CLI stubs

Hermetic no-op shims for external CLIs the agent is asked to run during an eval
(e.g. `auth0`). They let the agent's shell command **succeed deterministically —
no auth, no network, no live side effects** — so a real tenant is never touched
and the agent doesn't see an error and thrash.

## Why this exists

Some evals ask the agent to configure a tenant via a CLI — e.g. the
`react_mfa_cli` MFA eval runs `auth0 api put guardian/factors/otp --data
'{"enabled":true}'`. Running the real command would need credentials and would
mutate a live tenant, breaking hermeticity. The eval only needs to verify the
agent **knew to run the correct command** (checked by the `ranCommandOneOf` /
`wroteFile` event graders against the tool-call trace), not that a tenant
actually changed. These stubs make that command succeed without doing anything.

## How it's wired (do not re-plumb — it's done)

One env var, `EVAL_MOCK_BIN_DIR`, is prepended to the agent's `PATH` by
`filteredEnv()` (`packages/eval-core/src/utils/env.ts`). Prepending — ahead of
any real binary — guarantees a real install can never be hit. This directory
serves **all three execution contexts**:

| Context                              | Who sets `EVAL_MOCK_BIN_DIR`                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Docker sandbox                       | `docker/entrypoint.sh` → `/app/mocks` (dir copied from `apps/auth0-evals/mocks/` by `docker/Dockerfile`) |
| Local (`--dangerously-skip-sandbox`) | `packages/eval/src/cli/run.ts` → `<cwd>/mocks` = `apps/auth0-evals/mocks/`                               |
| CI                                   | uses the local path above                                                                                |

Per-eval routes (**the default for tenant-config surfaces**): an eval ships its
own `routes/` dir next to its `PROMPT.md` — a `<surface>.routes.json` manifest,
its `fixtures/<surface>/`, and a `handlers.js`. `run.ts` sets
`EVAL_MOCK_ROUTES_DIRS` to that dir and the dispatcher merges it with the shared
`mocks/` dir. So `guardian` lives in `src/evals/mfa/tenant-cli/routes/` and
`token-exchange` in `src/evals/custom-token-exchange/tenant-cli/routes/`, not
here. Those files live in the eval source tree, never in the agent workspace, so
they are never graded or seen by the judge (defensively also excluded via
`EXCLUDED_EVAL_DIRS` and the judge exclusions).

A stub is intercepted **only if a file with that exact command name exists
here** — every other command resolves to the real binary as normal. The
directory is a whitelist by presence.

## Extending a mock — three axes, cheapest first

Match the tier to what the eval actually needs. Don't build ahead of need:
over-mocking masks real failures (`AGENTS.md` principle #4 — "if every model
passes, the eval is broken").

| The eval needs…                                       | Tier                 | Work                                    |
| ----------------------------------------------------- | -------------------- | --------------------------------------- |
| The agent to _run_ a command; grader checks the trace | **1 — breadth**      | Drop a stub file                        |
| A _different_ CLI (`terraform`, `gcloud`, …)          | **1 — breadth**      | Drop a stub file (deeper if multi-step) |
| The agent to _read_ the CLI's output and act on it    | **2 — depth**        | Add a fixture + a route                 |
| A grader to assert on args the trace doesn't capture  | **3 — verification** | Log invocations to a file               |

### Axis 1 — Add a new CLI (breadth)

Drop an executable named after the tool into this directory, make it executable,
echo plausible success, `exit 0`. Picked up automatically in all three contexts
— no code change.

```sh
# mocks/terraform
#!/bin/sh
echo "mock terraform: $* ok"
exit 0
```

Multi-step CLIs (`terraform init` / `plan` / `apply`) whose output the agent
reads between steps need per-subcommand handling — that's Axis 2.

### Axis 2 — Add realistic per-endpoint responses (depth)

When a grader or the agent consumes the **response body**, add a route. The
`auth0` mock is a **dumb dispatcher + per-feature route files**: the dispatcher
(`mocks/auth0`) normalizes the path, then sources every `mocks/routes/*.sh` until
one handles the request; if none do, it falls through (writes → `{"ok":true}`,
reads → `{}`). A feature adds its endpoints by dropping **one file** in
`mocks/routes/` — no edit to the dispatcher, so route files never conflict.

```
mocks/                         # shared: dispatcher + contract only
├── auth0                      # dispatcher — shared mechanism, no feature knowledge
└── routes/README.md           # the manifest contract

src/evals/mfa/tenant-cli/routes/               # a feature's surface, co-located
├── guardian.routes.json       # one Auth0 API surface per manifest
├── handlers.js                # computed responses for this surface
└── fixtures/guardian/*.json   # canned bodies

src/evals/custom-token-exchange/tenant-cli/routes/
├── token-exchange.routes.json
├── handlers.js
└── fixtures/token-exchange/*.json
```

A manifest declares routes as `{ "match": "<METHOD> <path>", "verb": ... }` and
the dispatcher applies the verb (static / create / reflect / handler). See
`mocks/routes/README.md` for the full contract. Rules that keep it hermetic and
honest:

- **Co-locate the manifest with its eval, named by API surface** —
  `guardian.routes.json` under the consuming eval's `routes/`, not `mfa-cli.routes.json`.
  A surface shared by several evals may instead live in the shared `mocks/` dir.
- **Fake-but-plausible** values only (e.g. an id that looks real but points nowhere).
- **GET returns data; PUT/PATCH/POST echo success** — mirror the real API's
  shape enough for the agent's follow-up logic.
- **Paths are normalized by the dispatcher** — a full `https://<tenant>/api/v2/<path>`
  URL, a `/api/v2/<path>`, and a bare `<path>` all reach the same route.
- Add a route **only when an eval needs that endpoint's content.** Unmapped
  requests already succeed via the fallthrough — don't pre-populate endpoints
  nothing tests.

#### Read-after-write state (Axis 2.5)

When an eval verifies a **multi-step** CLI flow where a later `get` must reflect
an earlier `put` (e.g. enable a factor, then read it back before enforcing a
policy), the route file needs per-run state. Use the `lib.sh` helpers
(`record_state` / `has_state` / `clear_state`), which store marker files under
**`EVAL_MOCK_STATE_DIR`** and reflect them in subsequent reads.

Rules that keep this hermetic:

- State lives in `EVAL_MOCK_STATE_DIR` — a per-run temp dir **outside the
  workspace**, so graders never see it. `run.ts` creates one per run locally and
  `docker/entrypoint.sh` creates one per container in the sandbox;
  `filteredEnv()` forwards the var to the agent. The stub falls back to a temp
  dir if the var is unset.
- Keep state to **marker files**, not parsed JSON — no `jq` dependency, works in
  a POSIX `sh`.
- **Namespace your state keys** per feature to avoid collisions across route
  files — `record_state cte_action_created`, not `record_state created`.
- State is **within-run only** — never version-controlled, cleaned up with the
  run. Two concurrent runs get distinct dirs and never collide.

### Axis 3 — Assert on how the CLI was called (verification)

Usually unnecessary: graders already read the agent's tool-call trace, which
captures the full command. Only if a grader must assert on args the trace
doesn't preserve, append invocations to a log inside the workspace and have a
grader read it:

```sh
echo "$@" >> "${EVAL_MOCK_LOG:-/dev/null}"
```

Resist this until a concrete eval requires it — the trace is the better source
of truth, and a side-channel log is one more thing to keep hermetic.

## Testing a stub locally

Dispatcher behaviour (fallthrough + normalization) is feature-agnostic — a
routed endpoint's output depends on which `mocks/routes/*.sh` files are present:

```sh
export EVAL_MOCK_STATE_DIR="$(mktemp -d)"
mocks/auth0 api patch \
  https://t.us.auth0.com/api/v2/some/write \
  --data '{}'                                # → {"ok":true} (unmapped write; full URL routes like bare path)
mocks/auth0 api get some/unmapped            # → {}, exit 0 (unmapped read)
mocks/auth0 login --domain t.us.auth0.com    # → ✓ Successfully logged in (mock)
rm -rf "$EVAL_MOCK_STATE_DIR"
```

A feature's own routes (e.g. `mocks/routes/guardian.sh`) ship with that
feature's PR; test them from that branch.

Then run an eval that uses the CLI end-to-end and confirm the relevant event
grader passes, e.g.:

```sh
npm run evals -- --eval react_mfa_cli --mode agent \
  --model claude-sonnet-4-6 --dangerously-skip-sandbox
```
