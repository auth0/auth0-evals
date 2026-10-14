import { anyOf, ranCommandOneOf, ranCommandWithFlags, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. Grading leans entirely on event graders (command trace)
// plus a trace-aware judge.
//
// Tests that the agent creates a Native application with the custom-scheme
// callback/logout URLs, and configures grant types per current best practice.
// Two creation routes are accepted:
//   - `auth0 apps create --type native` with `--callbacks`/`--logout-urls`
//   - `auth0 qs setup --app --type native` (the skill's primary path) with
//     `--callback-url`/`--logout-url`. The workspace has no mobile project for it
//     to read a bundle ID from, so the scheme URLs must be passed explicitly.
// Note: neither route's default grants are best practice — the CLI defaults
// include the legacy `implicit` grant and `qs setup` sets no grants at all — so a
// best-practice solution must pass grants explicitly, at create time or with a
// follow-up `auth0 apps update --grants`.

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
    // ── L4: Create a Native application ───────────────────────────────────
    // Accept the dedicated subcommand, `qs setup`, and the raw Management API route.
    ranCommandOneOf(
      ['apps create', 'qs setup', 'quickstarts setup', ['api post', 'clients']],
      'Created a Native application',
      GraderLevel.L4,
      'native',
    ),

    // ── L4: Configure the custom-scheme callback / logout URLs ────────────
    // Bind each value to its own flag — both point at the com.example.quickstart
    // scheme, so a shared substring would pass even if only one flag were set.
    anyOf(
      [
        ranCommandWithFlags('apps create', [['--callbacks', 'com.example.quickstart']], undefined, GraderLevel.L4),
        ...qsSetupWithFlags([['--callback-url', 'com.example.quickstart']]),
      ],
      'Registered the custom-scheme callback URL',
      GraderLevel.L4,
    ),
    anyOf(
      [
        ranCommandWithFlags('apps create', [['--logout-urls', 'com.example.quickstart']], undefined, GraderLevel.L4),
        ...qsSetupWithFlags([['--logout-url', 'com.example.quickstart']]),
      ],
      'Registered the custom-scheme logout URL',
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
      'Based on the command trace, does the solution create a Native application with the ' +
        'Auth0 CLI (`auth0 apps create --type native`, `auth0 qs setup --app --type native`, or a raw ' +
        '`auth0 api post clients` call), register callback and logout URLs using the ' +
        'com.example.quickstart custom URL scheme, and configure grant types per current best ' +
        'practice (Authorization Code + refresh token, without the legacy implicit grant — set at ' +
        'create time or with a follow-up `auth0 apps update`), and name ' +
        'the application `Quickstart Native` — using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
