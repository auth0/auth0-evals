# CLI / Tenant-Config Evals

Most evals grade an **artifact on disk** — the app code an agent writes against an Auth0 SDK. A **CLI / tenant-config eval** grades something different: whether an agent can drive an Auth0 **tenant** into a required state (a factor enabled, a policy enforced, a profile created) using only the `auth0` CLI. The agent writes no source files, so there is nothing on disk to inspect. Instead, the artifact is the agent's **command trace** — the ordered list of shell commands it actually ran — evaluated against a real, throwaway tenant the CLI is pre-authenticated to.

This guide covers only what differs from a standard eval. For everything else (folder layout, auto-discovery, running/iterating), see [ADDING_EVALS.md](./ADDING_EVALS.md).

## How it differs from a standard eval

| | Standard eval | CLI / tenant-config eval |
| --- | --- | --- |
| Artifact | files the agent wrote | the agent's **command trace** |
| Scaffold | a starter app (`scaffold:`) | none for an app — but optionally a `seed.sh` that provisions tenant prerequisites (see [Seeding tenant prerequisites](#3-seeding-tenant-prerequisites-setup_command--scaffold)) |
| Graders | `contains` / `matches` / `notContains` / `compiles` | event-based `ranCommand` / `ranCommandOneOf` / `ranCommandsInOrder` |
| Judge | reads workspace files | reads the command trace (`includeCommandTrace: true`) |
| Environment | local workspace | a live, throwaway tenant provisioned per run |

Because the graders inspect the tool-call trace, these evals **only produce a meaningful signal in agent mode** — baseline mode runs no tools, so every grader fails there.

## Authoring one

### 1. `PROMPT.md` — goal-only, with `provision`

State the required **end state**, not the commands — the agent should work out the CLI surface itself. Add `provision: auth0-tenant` to the frontmatter, and omit `scaffold:` and `compile_command`.

```markdown
---
id: mfa_cli
name: MFA Config (CLI)
category: mfa
skills: auth0
provision: auth0-tenant
---

## Task

Our Auth0 tenant needs multi-factor authentication required for step-up flows — a
factor merely being available is not enough; MFA must actually be enforced.

Using the Auth0 CLI, enable the required MFA factor on the tenant and then enforce
MFA so it is required for users.
```

`provision: auth0-tenant` does two things:

- **Signals the eval runner** to stand up a throwaway tenant and pre-authenticate the `auth0` CLI to it before the agent starts (the framework loader itself doesn't provision anything — it only reads the field).
- **Drives context injection**: the matching entry in `cliContext` (in `eval.config.js`) is appended to the agent's native context file (`CLAUDE.md` / `AGENTS.md` / …). This is how the "you're on an already-authenticated live tenant — don't re-login, don't hardcode or look up domain/client-id/secret, stay non-interactive, never print secrets" platform guidance reaches the agent.

> Use `provision` + `cliContext` instead of a `## System` section. `## System` only feeds **baseline** mode and never reaches the agent, which is the mode these evals target.

### 2. `graders.ts` — event graders + a trace-aware judge

Grade the trace. The event primitives (all L4/L5, level required):

- `ranCommand(command, args, description, level)` — the agent ran a successful command containing `command` and every `arg`. Use `args` to be precise (enforcing MFA is only correct if the policy call carries `all-applications`).
- `ranCommandOneOf(commands, description, level)` — at least one acceptable command ran (enabling *any* MFA factor — `otp` **or** `push` **or** `sms` — counts).
- `ranCommandsInOrder(steps, description, level)` — commands ran in relative order. **Order is correctness, not style**: a factor must be enabled *before* the policy that enforces it. Each step may itself be a one-of array.

End with one holistic `judge` (no level) with `{ includeCommandTrace: true }` — the eval writes no files, so the judge must see the commands to evaluate them.

```typescript
import { ranCommand, ranCommandOneOf, ranCommandsInOrder, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // L4 — enabled an MFA factor (any of otp/push/sms)
    ranCommandOneOf(
      ['guardian/factors/otp', 'guardian/factors/push', 'guardian/factors/sms'],
      'Enabled MFA factor via Auth0 CLI',
      GraderLevel.L4,
    ),
    // L4 — enforced MFA (arg-precise: a wrong payload fails)
    ranCommand('guardian/policies', ['all-applications'], 'Enforced MFA via guardian/policies', GraderLevel.L4),
    // L4 — factor enabled BEFORE the enforcement policy that relies on it
    ranCommandsInOrder(
      [['guardian/factors/otp', 'guardian/factors/push', 'guardian/factors/sms'], 'guardian/policies'],
      'Enabled factor before setting enforcement policy',
      GraderLevel.L4,
    ),
    // Holistic judge — trace-aware, since there are no files to read
    judge(
      'Based on the command trace, does the solution enable an MFA factor via the Auth0 CLI AND ' +
        'enforce MFA via guardian/policies with the all-applications policy — WITHOUT using the ' +
        'dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
```

### 3. Seeding tenant prerequisites (`setup_command` + scaffold)

A provisioned tenant comes up **bare**. Depending on the runner it may have no applications and no connections at all - not even the default `Username-Password-Authentication`. If your task assumes something already exists ("configure **the** Single Page Application", "enable **the** default database connection"), you must create it before the agent runs, or the eval measures "can the model recover from an empty tenant" instead of the thing you meant to test — and weaker models fail for the wrong reason.

> Not every CLI eval needs this. Tenant-wide settings (the MFA eval's `guardian/factors` + `guardian/policies`) work on a bare tenant. You only need seeding when the task references a resource that must pre-exist (an app, a connection, an org).

Seed it with two pieces that live in the eval directory:

1. A **`scaffold/seed.sh`** script — copied into the agent's workspace before the run.
2. **`setup_command: bash seed.sh`** in `PROMPT.md` frontmatter.

`setup_command` runs after the scaffold is copied and **before the agent starts**, in the same container the `auth0` CLI is authenticated to, with the workspace as its working directory (5-minute default timeout). A non-zero exit **aborts the whole run**.

**Why a script, not inline commands.** `setup_command` is executed without a shell — it's split on whitespace and run via `spawnSync` — so quoting, pipes, and spaces in arguments break (`auth0 apps create --name "Acme SPA" …` splits `"Acme` and `SPA"` into separate args). Invoking `bash seed.sh` is two whitespace-safe tokens, and the script then gets a real shell.

```bash
#!/usr/bin/env bash
# scaffold/seed.sh — create the prerequisites the task assumes already exist.
# Idempotent by design: never assume a pristine tenant, never abort on "already exists".
set -uo pipefail   # NOT `set -e` — a create that already exists must not fail the run

log() { echo "[seed] $*" >&2; }

# Default database connection (seed defensively — it may not be auto-created).
# `get` absorbs already-exists; a create that still fails is a real error — exit non-zero.
if auth0 api get "connections?name=Username-Password-Authentication" | jq -e '.[0]' >/dev/null 2>&1; then
  log "connection already present — skipping"
elif ! auth0 api post connections --data '{"name":"Username-Password-Authentication","strategy":"auth0"}' >/dev/null; then
  log "error: failed to create default connection"
  exit 1
fi

# A Single Page Application for the agent to configure
# (`--json` is required — without it the CLI prints a human table that jq can't parse)
if auth0 apps list --json | jq -e '.[] | select(.app_type=="spa")' >/dev/null 2>&1; then
  log "a Single Page Application already exists — skipping"
elif ! auth0 apps create --name "Acme SPA" --type spa --auth-method None \
       --callbacks "http://localhost:3000" --logout-urls "http://localhost:3000" --origins "http://localhost:3000" >/dev/null; then
  log "error: failed to create Single Page Application"
  exit 1
fi

rm -f -- "$0"   # remove self so the agent never sees the seed script
exit 0
```

```yaml
---
id: organizations_cli
provision: auth0-tenant
setup_command: bash seed.sh
---
```

Three rules that keep this robust:

- **Idempotent, but not failure-blind.** Guard every create with a check-or-create and avoid `set -e`, so a re-run — or a not-quite-blank tenant — doesn't abort setup. The `get` check absorbs "already exists"; a create that fails *after* that is a real error — `exit 1` on it so the non-zero status reaches the runner instead of falling through to `exit 0`.
- **Seed infrastructure, not answers.** The script is copied into the workspace, so it's visible to the agent (and, for file-based `contains`/`notContains` graders, part of the grading corpus). Create resources only; never encode expected values or grader hints. The `rm -f -- "$0"` line deletes the script before the agent runs, which removes it from both the agent's view and the corpus — keep it.
- **Do not hardcode IDs into `PROMPT.md`.** The tenant is per-run and its resource IDs don't exist until seeded/created. A hardcoded domain or `client_id` in the prompt is stale on every run and will make the agent target a resource that doesn't exist (e.g. a `PATCH clients/<fake-id>` that 404s). Let the agent discover IDs at runtime from the authenticated CLI — that's what `cliContext` already tells it to do.
- **Log to stderr for observability.** `setup_command` runs with `stdio: 'inherit'`, so anything the script writes to stderr lands in the run / CI job log. Emit `[seed]` progress lines (`log() { echo "[seed] $*" >&2; }`) — they're already written by the time the script `rm`s itself, so the log stays your durable proof that the seed ran and what it created vs. skipped.

## Worked example

Two reference implementations live under `apps/auth0-evals/src/evals/`:

- `mfa/cli/` — tenant-wide settings, **no seeding** needed.
- `organizations/cli/` — configures a pre-existing app and connection, so it **seeds prerequisites** via `scaffold/seed.sh` + `setup_command`.
