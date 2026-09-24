import { ranCommand, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk — grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
//
// Tests that the agent creates a Regular Web Application via
// `auth0 apps create --type regular` with the local dev callback/logout URLs, and
// configures grant types per current best practice. The CLI's default grants for a
// regular web app include the legacy `implicit` grant, so a best-practice solution
// must pass grants explicitly (Authorization Code + refresh_token).
export function defineGraders() {
  return [
    // ── L4: Create a Regular Web Application ──────────────────────────────
    ranCommand('apps create', ['regular'], 'Created a Regular Web Application via auth0 apps create', GraderLevel.L4),

    // ── L4: Configure the callback URL ────────────────────────────────────
    ranCommand(
      'apps create',
      ['localhost:3000/callback'],
      'Configured the local dev callback URL',
      GraderLevel.L4,
    ),

    // ── L5: Explicitly set best-practice grants (Auth Code + refresh) ─────
    ranCommand(
      'apps create',
      ['authorization_code', 'refresh_token'],
      'Explicitly configured Authorization Code + refresh token grants',
      GraderLevel.L5,
    ),

    // ── L2: Must NOT enable the legacy implicit grant ─────────────────────
    notRanCommand('implicit', 'Did not enable the legacy implicit grant', GraderLevel.L2),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution create a Regular Web Application via ' +
        '`auth0 apps create --type regular`, set the callback URL to http://localhost:3000/callback ' +
        'and the logout URL to http://localhost:3000, and configure grant types per current best ' +
        'practice (Authorization Code + refresh token, without the legacy implicit grant) — ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
