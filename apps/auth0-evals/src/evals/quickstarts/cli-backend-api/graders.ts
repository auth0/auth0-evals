import { ranCommandOneOf, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk — grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
//
// Tests that the agent registers an API (resource server) via `auth0 apis create`
// with the given identifier/audience and the requested permissions (scopes). A
// backend-API quickstart needs an API resource, not an application — creating an
// application instead does not satisfy the task.
export function defineGraders() {
  return [
    // ── L2: Must register an API, not an application ──────────────────────
    notRanCommand('apps create', 'Registered an API rather than creating an application', GraderLevel.L2),

    // ── L4: Create the API with the given identifier (audience) ───────────
    // Accept both the dedicated subcommand and the raw Management API route.
    ranCommandOneOf(
      ['apis create', ['api post', 'resource-servers']],
      'Registered the API with the given identifier/audience',
      GraderLevel.L4,
      'https://quickstart-api.example.com',
    ),

    // ── L4: Define the requested permissions (scopes) ─────────────────────
    // Scopes may be set at create time or via `auth0 apis update`; pin the
    // identifier so scopes belonging to another API can't satisfy the check.
    ranCommandOneOf(
      ['apis create', 'apis update', ['api post', 'resource-servers']],
      'Defined the requested API permissions (scopes)',
      GraderLevel.L4,
      ['https://quickstart-api.example.com', 'read:messages', 'write:messages'],
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution register an API (resource server) with the ' +
        'Auth0 CLI (either `auth0 apis create` or a raw `auth0 api post resource-servers` call), ' +
        'using https://quickstart-api.example.com as the identifier (audience) and defining the ' +
        'read:messages and write:messages permissions (scopes) — not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
