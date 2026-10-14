import { anyOf, ranCommandOneOf, ranCommandWithFlags, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. Grading leans entirely on event graders (command trace)
// plus a trace-aware judge.
//
// Tests that the agent creates a SPA application with the local dev
// callback/logout/origin URLs, and configures grant types per current best
// practice. Two creation routes are accepted:
//   - `auth0 apps create --type spa` with `--callbacks`/`--logout-urls`/`--web-origins`
//   - `auth0 qs setup --app --type spa` (the skill's primary path), which derives
//     all three URLs from `--port` or takes them from `--callback-url`/
//     `--logout-url`/`--web-origin-url`. Its React default port is 5173, so the
//     task's localhost:3000 must be passed explicitly.
// Note: neither route's default grants are best practice for a SPA — the CLI
// defaults include the legacy `implicit` grant and `qs setup` sets no grants at
// all — so a best-practice solution must pass grants explicitly, at create time or
// with a follow-up `auth0 apps update --grants`.

// `auth0 qs setup` is an alias of `auth0 quickstarts setup`; accept either spelling.
const qsSetupWithFlags = (flags: Array<[string, string]>) => [
  ranCommandWithFlags('qs setup', flags, undefined, GraderLevel.L4),
  ranCommandWithFlags('quickstarts setup', flags, undefined, GraderLevel.L4),
];

const BEST_PRACTICE_GRANTS: Array<[string, string]> = [
  ['--grants', 'code'],
  ['--grants', 'refresh-token'],
];

export function defineGraders() {
  return [
    // ── L4: Create a SPA application ──────────────────────────────────────
    // Accept the dedicated subcommand, `qs setup`, and the raw Management API route.
    ranCommandOneOf(
      ['apps create', 'qs setup', 'quickstarts setup', ['api post', 'clients']],
      'Created a SPA application',
      GraderLevel.L4,
      'spa',
    ),

    // ── L4: Configure the local dev callback / logout / origin URLs ───────
    // All three point at http://localhost:3000, so bind each value to its own
    // flag — a shared substring check would pass even if only one flag were set.
    // `qs setup --port 3000` sets all three at once.
    anyOf(
      [
        ranCommandWithFlags('apps create', [['--callbacks', 'localhost:3000']], undefined, GraderLevel.L4),
        ...qsSetupWithFlags([['--callback-url', 'localhost:3000']]),
        ...qsSetupWithFlags([['--port', '3000']]),
      ],
      'Configured the local dev callback URL',
      GraderLevel.L4,
    ),
    anyOf(
      [
        ranCommandWithFlags('apps create', [['--logout-urls', 'localhost:3000']], undefined, GraderLevel.L4),
        ...qsSetupWithFlags([['--logout-url', 'localhost:3000']]),
        ...qsSetupWithFlags([['--port', '3000']]),
      ],
      'Configured the local dev logout URL',
      GraderLevel.L4,
    ),
    anyOf(
      [
        ranCommandWithFlags('apps create', [['--web-origins', 'localhost:3000']], undefined, GraderLevel.L4),
        ...qsSetupWithFlags([['--web-origin-url', 'localhost:3000']]),
        ...qsSetupWithFlags([['--port', '3000']]),
      ],
      'Configured the allowed web origin',
      GraderLevel.L4,
    ),

    // ── L5: Explicitly set best-practice grants (Auth Code + refresh) ─────
    // Passing these explicitly overrides the defaults, which would otherwise
    // include the legacy `implicit` grant for a SPA. `qs setup` has no grants
    // flag, so that route needs a follow-up `apps update --grants`.
    // Bind both grant values to the --grants argument so a value that merely
    // appears under another flag (e.g. --description refresh-token) can't pass.
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
      'Based on the command trace, does the solution create a Single-Page Application with the ' +
        'Auth0 CLI (`auth0 apps create --type spa`, `auth0 qs setup --app --type spa`, or a raw ' +
        '`auth0 api post clients` call), set the callback URL, logout URL, and allowed web origin ' +
        'to http://localhost:3000, and configure grant types per current best practice ' +
        '(Authorization Code + refresh token, without the legacy implicit grant — set at create ' +
        'time or with a follow-up `auth0 apps update`), and name the ' +
        'application `Quickstart SPA` — using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
