import { anyOf, ranCommandOneOf, ranCommandWithFlags, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. Grading leans entirely on event graders (command trace)
// plus a trace-aware judge.
//
// Tests that the agent creates a Regular Web Application with the local dev
// callback/logout URLs, and configures grant types per current best practice.
// Two creation routes are accepted:
//   - `auth0 apps create --type regular` with `--callbacks`/`--logout-urls`
//   - `auth0 qs setup --app --type regular` (the skill's primary path), which
//     derives the URLs from `--port` or takes them from `--callback-url`/
//     `--logout-url`. For `--framework express` the default port is 3000 and the
//     callback path is `/callback`, so it yields exactly the task's URLs with no
//     URL or port in the command.
// Note: neither route's default grants are best practice — the CLI defaults
// include the legacy `implicit` grant and `qs setup` sets no grants at all — so a
// best-practice solution must pass grants explicitly, at create time or with a
// follow-up `auth0 apps update --grants`.

// `auth0 qs setup` is an alias of `auth0 quickstarts setup`; accept either spelling.
const qsSetupWithFlags = (flags: Array<[string, string]>) => [
  ranCommandWithFlags('qs setup', flags, undefined, GraderLevel.L4),
  ranCommandWithFlags('quickstarts setup', flags, undefined, GraderLevel.L4),
];

// `qs setup` routes that land on localhost:3000: an explicit `--port 3000`, or
// `--framework express`, whose default port is 3000. (An express run with an
// explicit non-3000 `--port` would also match; the judge reads the full trace.)
const qsSetupOnPort3000 = [
  ...qsSetupWithFlags([['--port', '3000']]),
  ...qsSetupWithFlags([['--framework', 'express']]),
];

const BEST_PRACTICE_GRANTS: Array<[string, string]> = [
  ['--grants', 'code'],
  ['--grants', 'refresh-token'],
];

export function defineGraders() {
  return [
    // ── L4: Create a Regular Web Application ──────────────────────────────
    // Accept the dedicated subcommand, `qs setup`, and the raw Management API route.
    ranCommandOneOf(
      ['apps create', 'qs setup', 'quickstarts setup', ['api post', 'clients']],
      'Created a Regular Web Application',
      GraderLevel.L4,
      'regular',
    ),

    // ── L4: Configure the callback and logout URLs ────────────────────────
    // Bind each value to its own flag — the logout URL (localhost:3000) is a
    // substring of the callback URL, so a shared check would pass on either.
    anyOf(
      [
        ranCommandWithFlags('apps create', [['--callbacks', 'localhost:3000/callback']], undefined, GraderLevel.L4),
        ...qsSetupWithFlags([['--callback-url', 'localhost:3000/callback']]),
        ...qsSetupOnPort3000,
      ],
      'Configured the local dev callback URL',
      GraderLevel.L4,
    ),
    anyOf(
      [
        ranCommandWithFlags('apps create', [['--logout-urls', 'localhost:3000']], undefined, GraderLevel.L4),
        ...qsSetupWithFlags([['--logout-url', 'localhost:3000']]),
        ...qsSetupOnPort3000,
      ],
      'Configured the local dev logout URL',
      GraderLevel.L4,
    ),

    // ── L5: Explicitly set best-practice grants (Auth Code + refresh) ─────
    // `qs setup` has no grants flag, so that route needs a follow-up
    // `apps update --grants`. Bind both grant values to the --grants argument so a
    // value that merely appears under another flag (e.g. --description
    // refresh-token) can't pass.
    anyOf(
      [
        ranCommandWithFlags('apps create', BEST_PRACTICE_GRANTS, undefined, GraderLevel.L5),
        ranCommandWithFlags('apps update', BEST_PRACTICE_GRANTS, undefined, GraderLevel.L5),
      ],
      'Explicitly configured Authorization Code + refresh token grants',
      GraderLevel.L5,
    ),

    // ── L2: Must NOT enable the legacy implicit grant ─────────────────────
    notRanCommand('implicit', 'Did not enable the legacy implicit grant', GraderLevel.L2),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution create a Regular Web Application with the ' +
        'Auth0 CLI (`auth0 apps create --type regular`, `auth0 qs setup --app --type regular`, or a raw ' +
        '`auth0 api post clients` call), set the callback URL to http://localhost:3000/callback ' +
        'and the logout URL to http://localhost:3000, and configure grant types per current best ' +
        'practice (Authorization Code + refresh token, without the legacy implicit grant — set at ' +
        'create time or with a follow-up `auth0 apps update`), and name ' +
        'the application `Quickstart Web App` — using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
