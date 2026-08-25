import { ranCommand, ranCommandOneOf, ranCommandsInOrder, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into (requested via `provision: auth0-tenant` in PROMPT.md
// frontmatter, which the eval runner reads to provision the tenant; the
// framework loader ignores the field). It runs the MFA tenant-config scenario
// against a real tenant rather than a mocked Guardian surface. The agent writes
// nothing to disk, so grading leans entirely on event graders (which inspect the
// agent's successful shell calls) plus a trace-aware judge
// (`includeCommandTrace: true`). Baseline mode runs no tools, so every grader
// fails there — this eval is meant for agent mode.
export function defineGraders() {
  return [
    // ── L4: Enable an MFA factor via the Auth0 CLI (event-based) ──────────
    // Reads the tool-call trace, not file contents — the whole task is CLI
    // invocations, so there is no artifact to inspect with contains/matches.
    ranCommandOneOf(
      ['guardian/factors/otp', 'guardian/factors/push', 'guardian/factors/sms'],
      'Enabled MFA factor via Auth0 CLI',
      GraderLevel.L4,
    ),
    // ── L4: Enforce MFA — the step agents skip, leaving an enabled-but- ────
    // unenforced tenant. Arg-precise so a wrong payload (e.g. an empty policy
    // list) fails.
    ranCommand('guardian/policies', ['all-applications'], 'Enforced MFA via guardian/policies', GraderLevel.L4),
    // ── L4: Sequence — factor must be enabled BEFORE the enforcement policy ─
    // that relies on it.
    ranCommandsInOrder(
      [['guardian/factors/otp', 'guardian/factors/push', 'guardian/factors/sms'], 'guardian/policies'],
      'Enabled factor before setting enforcement policy',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    // includeCommandTrace: this eval writes no files — the artifact is the CLI
    // trace, so the judge must see the commands the agent ran to evaluate it.
    judge(
      'Based on the command trace, does the solution enable an MFA factor on the Auth0 tenant via ' +
        'the Auth0 CLI (auth0 api put guardian/factors/...) AND enforce MFA via the guardian/policies ' +
        'endpoint with the all-applications policy — WITHOUT configuring MFA through the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
