import { ranCommand, ranCommandOneOf, ranCommandsInOrder, judge, GraderLevel } from '@a0/evals-graders';

// Goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into (requested via `provision: auth0-tenant` in PROMPT.md).
// The agent writes no source files, so grading is entirely trace-based: event
// graders inspect the agent's successful shell calls plus a trace-aware judge.
// Baseline mode runs no tools, so every grader fails there — agent mode only.
//
// Custom Token Exchange has three moving parts that are easy to leave half-done:
// an Action on the `custom-token-exchange` trigger, a *deploy* of that Action
// (agents frequently create it and stop, leaving a draft), and a
// token-exchange-profile that binds a subject token type to the deployed Action.
// The exchange is only usable when all three exist and are wired in order.
export function defineGraders() {
  return [
    // ── L4: Created an Action on the Custom Token Exchange trigger ──────────
    // The trigger id appears verbatim in `auth0 actions create --trigger
    // custom-token-exchange` (or the raw `auth0 api post actions/actions`
    // payload), so match the trigger id itself.
    ranCommandOneOf(
      ['custom-token-exchange', 'custom_token_exchange'],
      'Created an Action bound to the custom-token-exchange trigger',
      GraderLevel.L4,
    ),
    // ── L4: Deployed the Action — the step agents skip, leaving a draft ─────
    ranCommand('actions', 'deploy', 'Deployed the Action so it is live', GraderLevel.L4),
    // ── L4: Created a token exchange profile linking the subject token ──────
    // type to the deployed Action.
    ranCommandOneOf(
      ['token-exchange-profiles', 'token-exchange-profile'],
      'Created a token exchange profile',
      GraderLevel.L4,
    ),
    // ── L4: Sequence — the Action must exist and be deployed BEFORE the ─────
    // profile that references it, otherwise the profile points at nothing.
    ranCommandsInOrder(
      [
        ['custom-token-exchange', 'custom_token_exchange'],
        'deploy',
        ['token-exchange-profiles', 'token-exchange-profile'],
      ],
      'Created and deployed the Action before creating the profile that references it',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    // includeCommandTrace: the artifact is the CLI trace, so the judge must see
    // the commands the agent ran to evaluate them.
    judge(
      'Based on the command trace, does the solution set up Custom Token Exchange end to end via the ' +
        'Auth0 CLI: (1) create an Action on the custom-token-exchange trigger, (2) deploy that Action, and ' +
        '(3) create a token-exchange-profile that binds a custom subject_token_type to the deployed Action ' +
        '(type custom_authentication) — WITHOUT configuring it through the dashboard or Terraform, and ' +
        'without leaving the Action as an undeployed draft?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
