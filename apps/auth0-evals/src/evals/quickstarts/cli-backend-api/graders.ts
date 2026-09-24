import { ranCommand, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

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
    ranCommand(
      'apis create',
      ['https://quickstart-api.example.com'],
      'Registered the API with the given identifier/audience',
      GraderLevel.L4,
    ),

    // ── L4: Define the requested permissions (scopes) ─────────────────────
    ranCommand(
      'apis create',
      ['read:messages'],
      'Defined the requested API permissions (scopes)',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution register an API (resource server) via ' +
        '`auth0 apis create`, using https://quickstart-api.example.com as the identifier (audience) ' +
        'and defining the read:messages and write:messages permissions (scopes) — ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
