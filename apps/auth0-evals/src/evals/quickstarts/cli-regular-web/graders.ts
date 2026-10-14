import { ranCommand, ranCommandWithFlags, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk — grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
//
// Tests that the agent creates a Regular Web Application via
// `auth0 qs setup --type regular` with the local dev callback/logout URLs.
// The CLI's default grants (which include Authorization Code + refresh_token) are
// acceptable, so the agent need not pass `--grants`.
export function defineGraders() {
  return [
    // ── L4: Create a Regular Web Application ──────────────────────────────
    ranCommand('qs setup', ['regular'], 'Created a Regular Web Application', GraderLevel.L4),

    // ── L4: Configure the callback and logout URLs ────────────────────────
    // Bind each value to its own flag — the logout URL (localhost:3000) is a
    // substring of the callback URL, so a shared check would pass on either.
    ranCommandWithFlags(
      'qs setup',
      [['--callback-url', 'localhost:3000/callback']],
      'Configured the local dev callback URL',
      GraderLevel.L4,
    ),
    ranCommandWithFlags(
      'qs setup',
      [['--logout-url', 'localhost:3000']],
      'Configured the local dev logout URL',
      GraderLevel.L4,
    ),

    // ── L2: Must NOT enable the legacy implicit grant ─────────────────────
    notRanCommand('implicit', 'Did not enable the legacy implicit grant', GraderLevel.L2),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution create a Regular Web Application with the ' +
        'Auth0 CLI (via `auth0 qs setup --type regular`), set the callback URL to http://localhost:3000/callback and the logout URL to http://localhost:3000, and name the application `Quickstart Web App` — ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
