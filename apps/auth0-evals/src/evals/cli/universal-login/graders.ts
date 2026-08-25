import { ranCommandOneOf, judge, GraderLevel } from '@a0/evals-graders';

// Goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into (requested via `provision: auth0-tenant` in PROMPT.md).
// The agent writes no source files, so grading is trace-based: event graders
// inspect the agent's successful shell calls plus a trace-aware judge. Baseline
// mode runs no tools, so every grader fails there — agent mode only.
//
// Two distinct things must happen and agents routinely do only one: flip the
// tenant onto the New Universal Login experience (a prompts setting) AND apply
// branding (color + logo). The branding grader accepts both the dedicated
// `auth0 universal-login`/`auth0 ul` verbs and the raw `auth0 api ... branding`
// path, since either is a correct way to reach the same setting.
export function defineGraders() {
  return [
    // ── L4: Switched the tenant to the New Universal Login experience ───────
    // Set via the prompts endpoint (`universal_login_experience: "new"`), or
    // the `auth0 ul`/`universal-login` command surface.
    ranCommandOneOf(
      ['universal_login_experience', 'prompts', 'universal-login', 'ul '],
      'Enabled the New Universal Login experience',
      GraderLevel.L4,
    ),
    // ── L4: Applied brand color to the login pages ──────────────────────────
    // The hex appears in the branding payload whether set via `auth0 api patch
    // branding` or `auth0 ul update`.
    ranCommandOneOf(['#635BFF', '635BFF', '635bff'], 'Applied the brand primary color to branding', GraderLevel.L4),
    // ── L4: Pointed the login page logo at the brand asset ──────────────────
    ranCommandOneOf(
      ['cdn.acme.test/logo.png', 'logo.png'],
      'Set the login page logo to the brand asset',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    // includeCommandTrace: the artifact is the CLI trace, so the judge must see
    // the commands the agent ran.
    judge(
      'Based on the command trace, does the solution configure Universal Login via the Auth0 CLI so that ' +
        '(1) the tenant is on the New Universal Login experience (for example the prompts ' +
        'universal_login_experience set to "new"), and (2) branding is applied with the primary color ' +
        '#635BFF and the page logo https://cdn.acme.test/logo.png (via the branding Management API or the ' +
        'auth0 universal-login command) — WITHOUT using the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
