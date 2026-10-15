import { ranCommandOneOf, ranCommandWithFlags, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk — grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
//
// Tests that the agent creates a Native application via `auth0 apps create --type native`
// with the custom-scheme callback/logout URLs.
// The CLI's default grants (which include Authorization Code + refresh_token) are
// acceptable, so the agent need not pass `--grants`.
export function defineGraders() {
  return [
    // ── L4: Create a Native application ───────────────────────────────────
    // Accept both the dedicated subcommand and the raw Management API route.
    ranCommandOneOf(['apps create', ['api post', 'clients']], 'Created a Native application', GraderLevel.L4, 'native'),

    // ── L4: Configure the custom-scheme callback / logout URLs ────────────
    // Bind each value to its own flag — both point at the com.example.quickstart
    // scheme, so a shared substring would pass even if only one flag were set.
    ranCommandWithFlags(
      'apps create',
      [['--callbacks', 'com.example.quickstart']],
      'Registered the custom-scheme callback URL',
      GraderLevel.L4,
    ),
    ranCommandWithFlags(
      'apps create',
      [['--logout-urls', 'com.example.quickstart']],
      'Registered the custom-scheme logout URL',
      GraderLevel.L4,
    ),

    // ── L2: Must NOT enable the legacy implicit grant ─────────────────────
    notRanCommand('implicit', 'Did not enable the legacy implicit grant', GraderLevel.L2),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution create a Native application with the ' +
        'Auth0 CLI (either `auth0 apps create --type native` or a raw `auth0 api post clients` call), ' +
        'register callback and logout URLs using the ' +
        'com.example.quickstart custom URL scheme, and name ' +
        'the application `Quickstart Native` — using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
