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

| Context | Who sets `EVAL_MOCK_BIN_DIR` |
|---------|------------------------------|
| Docker sandbox | `docker/entrypoint.sh` → `/app/mocks` (dir copied in by `docker/Dockerfile`) |
| Local (`--dangerously-skip-sandbox`) | `packages/eval/src/cli/run.ts` → repo `mocks/` |
| CI | uses the local path above |

A stub is intercepted **only if a file with that exact command name exists
here** — every other command resolves to the real binary as normal. The
directory is a whitelist by presence.

## Extending a mock — three axes, cheapest first

Match the tier to what the eval actually needs. Don't build ahead of need:
over-mocking masks real failures (`AGENTS.md` principle #4 — "if every model
passes, the eval is broken").

| The eval needs… | Tier | Work |
|-----------------|------|------|
| The agent to *run* a command; grader checks the trace | **1 — breadth** | Drop a stub file |
| A *different* CLI (`terraform`, `gcloud`, …) | **1 — breadth** | Drop a stub file (deeper if multi-step) |
| The agent to *read* the CLI's output and act on it | **2 — depth** | Add a fixture + a route |
| A grader to assert on args the trace doesn't capture | **3 — verification** | Log invocations to a file |

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

When a grader or the agent consumes the **response body**, promote the stub to a
path router backed by static fixtures. See `mocks/auth0` for the live template:
it normalizes the path (so a full `https://<tenant>/api/v2/<path>` URL routes
like a bare `<path>`), keys on `"<method> <path>"`, `cat`s a fixture for reads,
echoes success for writes, and — for unmapped routes — echoes `{"ok":true}` for
writes and `{}` for reads.

```
mocks/
├── auth0                          # dispatcher
└── fixtures/
    └── auth0/
        └── guardian_factors.json  # one file per mapped read
```

Rules that keep it hermetic and honest:
- Fixtures are **static, version-controlled JSON** — no network, deterministic
  across runs.
- **Fake-but-plausible** values only (e.g. a client ID that looks real but
  points nowhere).
- **GET returns data; PUT/PATCH/POST echo success** — mirror the real API's
  shape enough for the agent's follow-up logic.
- **Paths are normalized** — a full `https://<tenant>/api/v2/<path>` URL and a
  bare `<path>` hit the same route, so the agent's command works whichever form
  it emits.
- Add a fixture **only when an eval needs that endpoint's content**. Unmapped
  reads return `{}` on purpose — don't pre-populate endpoints nothing tests. An
  unmapped **write** echoes `{"ok":true}` so a successful call never reads as a
  no-op (which made agents doubt the call landed and thrash).

#### Read-after-write state (Axis 2.5)

When an eval verifies a **multi-step** CLI flow where a later `get` must reflect
an earlier `put` (e.g. enable a factor, then read it back before enforcing a
policy), the stub needs per-run state. `mocks/auth0` is the live template: it
records writes as marker files under **`EVAL_MOCK_STATE_DIR`** and reflects them
in subsequent reads.

Rules that keep this hermetic:
- State lives in `EVAL_MOCK_STATE_DIR` — a per-run temp dir **outside the
  workspace**, so graders never see it. `run.ts` creates one per run locally and
  `docker/entrypoint.sh` creates one per container in the sandbox;
  `filteredEnv()` forwards the var to the agent. The stub falls back to a temp
  dir if the var is unset.
- Keep state to **marker files**, not parsed JSON — no `jq` dependency, works in
  a POSIX `sh`.
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

```sh
export EVAL_MOCK_STATE_DIR="$(mktemp -d)"
mocks/auth0 api get guardian/factors         # → all factors enabled:false, exit 0
mocks/auth0 api put guardian/factors/otp \
  --data '{"enabled": true}'                 # → {"enabled":true}, exit 0
mocks/auth0 api get guardian/factors         # → otp now enabled:true (read-after-write)
mocks/auth0 api patch \
  https://t.us.auth0.com/api/v2/guardian/factors/otp \
  --data '{"enabled":true}'                  # → {"enabled":true} (full URL routes like bare path)
mocks/auth0 api patch tenants/settings \
  --data '{"flags":{"enable_mfa":true}}'     # → {"ok":true} (unmapped write echoes success)
mocks/auth0 api get some/unmapped            # → {}, exit 0 (unmapped read)
rm -rf "$EVAL_MOCK_STATE_DIR"
```

Then run an eval that uses the CLI end-to-end and confirm the relevant event
grader passes, e.g.:

```sh
npm run evals -- --eval react_mfa_cli --mode agent \
  --model claude-sonnet-4-6 --dangerously-skip-sandbox
```
