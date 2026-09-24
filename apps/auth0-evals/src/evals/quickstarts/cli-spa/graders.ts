import { ranCommand, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk — grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
//
// Tests that the agent creates a SPA application via `auth0 apps create --type spa`
// with the local dev callback/logout/origin URLs, and configures grant types per
// current best practice. Note: the CLI's default grants for a SPA include the
// legacy `implicit` grant, so a best-practice solution must pass grants explicitly
// (Authorization Code + refresh_token) rather than rely on defaults.
export function defineGraders() {
  return [
    // ── L4: Create a SPA application ──────────────────────────────────────
    ranCommand('apps create', ['spa'], 'Created a SPA application via auth0 apps create', GraderLevel.L4),

    // ── L4: Configure the local dev callback / logout / origin URLs ───────
    // All three point at http://localhost:3000, so check each flag separately —
    // a single shared substring would pass even if only one flag were set.
    ranCommand(
      'apps create',
      ['--callbacks', 'localhost:3000'],
      'Configured the local dev callback URL',
      GraderLevel.L4,
    ),
    ranCommand(
      'apps create',
      ['--logout-urls', 'localhost:3000'],
      'Configured the local dev logout URL',
      GraderLevel.L4,
    ),
    ranCommand(
      'apps create',
      ['--web-origins', 'localhost:3000'],
      'Configured the allowed web origin',
      GraderLevel.L4,
    ),

    // ── L5: Explicitly set best-practice grants (Auth Code + refresh) ─────
    // Passing these explicitly overrides the CLI defaults, which would
    // otherwise include the legacy `implicit` grant for a SPA.
    ranCommand(
      'apps create',
      ['--grants', 'code', 'refresh-token'],
      'Explicitly configured Authorization Code + refresh token grants',
      GraderLevel.L5,
    ),

    // ── L2: Must NOT enable the legacy implicit grant ─────────────────────
    notRanCommand('implicit', 'Did not enable the legacy implicit grant', GraderLevel.L2),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution create a Single-Page Application via ' +
        '`auth0 apps create --type spa`, set the callback URL, logout URL, and allowed web origin ' +
        'to http://localhost:3000, and configure grant types per current best practice ' +
        '(Authorization Code + refresh token, without the legacy implicit grant) — ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
