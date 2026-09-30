import { ranCommandOneOf, ranCommandsInOrder, judge, GraderLevel } from '@a0/evals-graders';

// Goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into (requested via `provision: auth0-tenant` in PROMPT.md).
// The eval is self-seeding: the agent creates a confidential Regular Web
// Application and then rotates its client secret. The agent writes no source
// files, so grading is trace-based plus a trace-aware judge. Baseline mode runs
// no tools, so every grader fails there — agent mode only.
//
// This is a security-flow eval: the correct action is to actually rotate the
// secret (not merely read or display it), and to do so without persisting the
// secret to disk. The judge carries the "handled the secret safely" check, since
// there is no file artifact to scan with a notContains grader.
export function defineGraders() {
  return [
    // ── L4: Created the confidential application (the self-seed step) ───────
    ranCommandOneOf(
      ['apps create', 'clients create', 'api post clients'],
      'Created the confidential application via the Auth0 CLI',
      GraderLevel.L4,
    ),
    // ── L4: Rotated the client secret — the actual security action ─────────
    // `auth0 apps rotate-secret <id>` or `auth0 api post clients/{id}/rotate-secret`.
    ranCommandOneOf(
      ['rotate-secret', 'rotate_secret', '/rotate-secret'],
      'Rotated the application client secret',
      GraderLevel.L4,
    ),
    // ── L4: Sequence — the app must be created BEFORE its secret is rotated ─
    ranCommandsInOrder(
      [
        ['apps create', 'clients create', 'api post clients'],
        ['rotate-secret', 'rotate_secret'],
      ],
      'Created the application before rotating its secret',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    // includeCommandTrace: the artifact is the CLI trace, so the judge must see
    // the commands the agent ran — including whether it persisted the secret.
    judge(
      'Based on the command trace, does the solution create a confidential Regular Web Application named ' +
        '"Backend Service" via the Auth0 CLI and then rotate its client secret (for example via ' +
        '`auth0 apps rotate-secret` or the clients rotate-secret Management API endpoint), so the original ' +
        'secret is invalidated? It must handle the secret safely: it must NOT write the client secret into a ' +
        'file, commit it, or echo it into a persisted artifact. Answer "no" if the agent only displayed or read ' +
        'the secret without rotating it, or if it saved the secret to disk.',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
