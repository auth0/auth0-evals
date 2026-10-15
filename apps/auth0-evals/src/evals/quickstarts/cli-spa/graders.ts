import { ranCommandOneOf, ranCommandWithFlags, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk — grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
//
// Tests that the agent creates a SPA application via `auth0 apps create --type spa`
// with the local dev callback/logout/origin URLs.
// The CLI's default grants (which include Authorization Code + refresh_token) are
// acceptable, so the agent need not pass `--grants`.
export function defineGraders() {
  return [
    // ── L4: Create a SPA application ──────────────────────────────────────
    // Accept both the dedicated subcommand and the raw Management API route.
    ranCommandOneOf(['apps create', ['api post', 'clients']], 'Created a SPA application', GraderLevel.L4, 'spa'),

    // ── L4: Configure the local dev callback / logout / origin URLs ───────
    // All three point at http://localhost:3000, so bind each value to its own
    // flag — a shared substring check would pass even if only one flag were set.
    ranCommandWithFlags(
      'apps create',
      [['--callbacks', 'localhost:3000']],
      'Configured the local dev callback URL',
      GraderLevel.L4,
    ),
    ranCommandWithFlags(
      'apps create',
      [['--logout-urls', 'localhost:3000']],
      'Configured the local dev logout URL',
      GraderLevel.L4,
    ),
    ranCommandWithFlags(
      'apps create',
      [['--web-origins', 'localhost:3000']],
      'Configured the allowed web origin',
      GraderLevel.L4,
    ),

    // ── L2: Must NOT enable the legacy implicit grant ─────────────────────
    notRanCommand('implicit', 'Did not enable the legacy implicit grant', GraderLevel.L2),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution create a Single-Page Application with the ' +
        'Auth0 CLI (either `auth0 apps create --type spa` or a raw `auth0 api post clients` call), ' +
        'set the callback URL, logout URL, and allowed web origin ' +
        'to http://localhost:3000, and name the ' +
        'application `Quickstart SPA` — using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
