import { ranCommand, ranCommandOneOf, ranCommandsInOrder, judge, GraderLevel } from '@a0/evals-graders';

// Goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into (requested via `provision: auth0-tenant` in PROMPT.md).
// The agent writes no source files, so grading is trace-based: event graders
// inspect the agent's successful shell calls plus a trace-aware judge. Baseline
// mode runs no tools, so every grader fails there — agent mode only.
//
// This eval measures a two-phase security workflow: review the logs to
// understand current sign-in activity, THEN harden the tenant's attack-
// protection surface. It runs against a freshly provisioned tenant, so the logs
// are sparse and there is no seeded attack to find — the graded signal is the
// review-then-harden workflow, not a specific finding. (The /logs endpoint is
// read-only, so an attack spike cannot be injected without runner-side seeding.)
// The common failure is jumping straight to a canned "enable everything" without
// looking, or reviewing the logs and never actually applying the mitigation.
export function defineGraders() {
  return [
    // ── L4: Reviewed the authentication logs ────────────────────────────────
    // `auth0 logs list` / `auth0 logs tail`, or the raw `auth0 api get logs`.
    ranCommandOneOf(
      ['logs list', 'logs tail', 'api get logs', 'get logs', '/logs'],
      'Reviewed the tenant authentication logs',
      GraderLevel.L4,
    ),
    // ── L4: Enabled brute-force protection ──────────────────────────────────
    ranCommand(
      'brute-force-protection',
      'enabled',
      'Enabled brute-force protection via attack-protection',
      GraderLevel.L4,
    ),
    // ── L4: Enabled suspicious IP throttling ────────────────────────────────
    ranCommand(
      'suspicious-ip-throttling',
      'enabled',
      'Enabled suspicious IP throttling via attack-protection',
      GraderLevel.L4,
    ),
    // ── L4: Sequence — investigate BEFORE hardening ─────────────────────────
    // A log review that happens after the mitigation is not driving the
    // decision; correctness here is diagnose-then-respond.
    ranCommandsInOrder(
      [
        ['logs list', 'logs tail', 'api get logs', 'get logs', '/logs'],
        ['brute-force-protection', 'suspicious-ip-throttling'],
      ],
      'Reviewed logs before applying attack-protection hardening',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    // includeCommandTrace: the artifact is the CLI trace, so the judge must see
    // the commands the agent ran.
    judge(
      'Based on the command trace, does the solution first review the tenant authentication logs (via the ' +
        'Auth0 CLI logs commands or the /logs Management API), and THEN harden the tenant by enabling attack ' +
        'protection — at minimum brute-force-protection and suspicious-ip-throttling set to enabled — via the ' +
        'attack-protection Management API, WITHOUT using the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
