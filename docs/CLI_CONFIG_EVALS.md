# CLI / Tenant-Config Evals

Most evals grade an **artifact on disk** — the app code an agent writes against an Auth0 SDK. A **CLI / tenant-config eval** grades something different: whether an agent can drive an Auth0 **tenant** into a required state (a factor enabled, a policy enforced, a profile created) using only the `auth0` CLI. The agent writes no source files, so there is nothing on disk to inspect. Instead, the artifact is the agent's **command trace** — the ordered list of shell commands it actually ran — evaluated against a real, throwaway tenant the CLI is pre-authenticated to.

This guide covers only what differs from a standard eval. For everything else (folder layout, auto-discovery, running/iterating), see [ADDING_EVALS.md](./ADDING_EVALS.md).

## How it differs from a standard eval

| | Standard eval | CLI / tenant-config eval |
| --- | --- | --- |
| Artifact | files the agent wrote | the agent's **command trace** |
| Scaffold | a starter app (`scaffold:`) | none — there's no app to build |
| Graders | `contains` / `matches` / `notContains` / `compiles` | event-based `ranCommand` / `ranCommandOneOf` / `ranCommandsInOrder` |
| Judge | reads workspace files | reads the command trace (`includeCommandTrace: true`) |
| Environment | local workspace | a live, throwaway tenant provisioned per run |

Because the graders inspect the tool-call trace, these evals **only produce a meaningful signal in agent mode** — baseline mode runs no tools, so every grader fails there.

## Authoring one

### 1. `PROMPT.md` — goal-only, with `provision`

State the required **end state**, not the commands — the agent should work out the CLI surface itself. Add `provision: auth0-tenant` to the frontmatter, and omit `scaffold:` and `compile_command`.

```markdown
---
id: mfa_tenant_cli
name: MFA Tenant Config (CLI)
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

### 3. Verify

```bash
npm run build && npm run lint && npm test
```

Then run the eval end-to-end in agent mode against a provisioned tenant. Locally, without a provisioned tenant the trace graders fail on an empty trace — that's expected; a real pass needs the eval runner's live tenant.

## Worked example

The MFA tenant-config eval above lives at `apps/auth0-evals/src/evals/mfa/tenant-cli/` and is the reference implementation for this pattern.
