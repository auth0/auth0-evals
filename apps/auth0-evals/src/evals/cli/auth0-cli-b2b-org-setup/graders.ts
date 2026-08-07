import { ranCommand, ranCommandOneOf, wroteFile, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval: the agent drives a full B2B (organizations) setup against
// a live, throwaway tenant the CLI is already logged into. Because almost nothing
// is written to disk, grading leans on event graders (which inspect the agent's
// successful tool calls) plus a trace-aware judge (`includeCommandTrace: true`)
// that reads the manifest the agent leaves behind and cross-checks it against the
// commands it actually ran. Baseline mode runs nothing, so every grader fails
// there — this eval is meant for agent mode.
export function defineGraders() {
  return [
    // ── L3: Security ──────────────────────────────────────────────────────────
    judge(
      'No client secret must ever be exposed. Fail if any Auth0 client secret value ' +
        'appears in the smoke-b2b-manifest.json file or in the command trace — for ' +
        'example a secret printed by `auth0 apps create` and then echoed, stored in the ' +
        'manifest, or passed on a later command line. The manifest is expected to carry ' +
        'client_ids and resource ids (those are not secrets); only an actual client ' +
        'secret is a violation.',
      GraderLevel.L3,
      { includeCommandTrace: true },
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    //    Each grader asserts the endpoint/command an action MUST hit to be real
    //    (successful calls only); the judge below confirms the resulting outcome.
    //    The prompt names no command or flag, so the agent works out the CLI
    //    surface itself — including that a client grant and org enabled-connections
    //    have no dedicated subcommand and must go through `auth0 api`.
    ranCommand(
      'auth0 apis create',
      ['Smoke API', 'https://smoke.example.com'],
      'Created the protected API via `auth0 apis create`',
      GraderLevel.L4,
    ),
    ranCommand('auth0 roles create', ['Org Admin'], 'Created the `Org Admin` role', GraderLevel.L4),
    ranCommand('auth0 roles create', ['Org Member'], 'Created the `Org Member` role', GraderLevel.L4),
    // Base command only — permissions may be added in one comma-separated call or
    // several; the judge confirms the resulting permission sets.
    ranCommand(
      'auth0 roles permissions add',
      undefined,
      'Added API permission(s) to a role via `auth0 roles permissions add`',
      GraderLevel.L4,
    ),
    ranCommand(
      'auth0 apps create',
      ['Smoke Portal', 'http://localhost:3000/callback'],
      'Created the Regular Web App `Smoke Portal`',
      GraderLevel.L4,
    ),
    ranCommand('auth0 apps create', ['Smoke Automation'], 'Created the M2M app `Smoke Automation`', GraderLevel.L4),
    // The public CLI has no dedicated client-grants command, so the agent must
    // reach the Management API's client-grants endpoint through `auth0 api`. Match
    // the endpoint substring alone (rather than the `auth0 api` prefix) so this
    // still passes if a dedicated command later ships; the judge confirms the
    // audience and scopes.
    ranCommand(
      'client-grants',
      undefined,
      'Created an M2M client grant against the client-grants endpoint',
      GraderLevel.L4,
    ),
    ranCommand('auth0 orgs create', ['acme'], 'Created organization `acme`', GraderLevel.L4),
    ranCommand('auth0 orgs create', ['globex'], 'Created organization `globex`', GraderLevel.L4),
    // Enabling a connection on an org has no CLI subcommand either, so this also
    // goes through the Management API. Match the endpoint substring alone; the
    // judge confirms both orgs ended up with an enabled connection.
    ranCommand('enabled_connections', undefined, 'Enabled a login connection on an organization', GraderLevel.L4),
    ranCommand(
      'auth0 orgs invitations create',
      ['admin@acme.example.com'],
      'Invited an org admin via `auth0 orgs invitations create`',
      GraderLevel.L4,
    ),
    ranCommandOneOf(
      ['auth0 apps list', 'auth0 apis list', 'auth0 roles list', 'auth0 orgs list', 'auth0 orgs show'],
      'Listed/showed resources to confirm the setup',
      GraderLevel.L4,
    ),
    // `wroteFile` matches write_file/write/edit tool calls, so the prompt tells the
    // agent to create the file directly (not via a `>` redirect).
    wroteFile('smoke-b2b-manifest.json', 'Wrote the B2B manifest to `smoke-b2b-manifest.json`', GraderLevel.L4),
    judge(
      'A file named smoke-b2b-manifest.json should be present and be valid JSON describing a ' +
        'B2B (organizations) Auth0 setup. Pass ONLY if ALL of the following hold. ' +
        'API: `api.identifier` is "https://smoke.example.com" and `api.scopes` includes ' +
        '"read:reports", "write:reports", and "manage:members". ' +
        'Roles: `roles.admin` is named "Org Admin" with permissions including all three of ' +
        '"read:reports", "write:reports", "manage:members"; `roles.member` is named "Org Member" ' +
        'with permissions including "read:reports". ' +
        'Apps: `apps.portal` is named "Smoke Portal" with type "regular_web"; `apps.automation` ' +
        'is named "Smoke Automation" with type "non_interactive". ' +
        'M2M grant: `m2m_grant.audience` is "https://smoke.example.com" and `m2m_grant.scope` ' +
        'includes "read:reports" and "manage:members". ' +
        'Connection: `connection.id` and `connection.name` are non-empty. ' +
        'Organizations: `organizations.acme` has name "acme", display_name "Acme Inc", and a ' +
        'non-empty `enabled_connection_id`; `organizations.globex` has name "globex", ' +
        'display_name "Globex Corp", and a non-empty `enabled_connection_id`. ' +
        'Invitation: `invitation.org` is "acme", `invitation.invitee_email` is ' +
        '"admin@acme.example.com", and `invitation.role` is "Org Admin". ' +
        'Every id/client_id/grant id field should be a non-empty string. If the file is missing, ' +
        'is not valid JSON, or any of these is absent or inconsistent, fail. A `// COMMAND TRACE` ' +
        'section lists the shell commands the agent actually ran; use it to confirm the manifest ' +
        'values are backed by real `auth0` commands (API, roles, apps, client grant, orgs, enabled ' +
        'connections, invitation) and not fabricated.',
      GraderLevel.L4,
      { includeCommandTrace: true },
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────────
    judge(
      'Does the solution correctly configure the entire B2B organizations setup for the Smoke product ' +
        'using only the `auth0` CLI: a protected API with the three scopes, the Org Admin and Org Member ' +
        'roles wired to those scopes, a regular-web portal app and an M2M automation app, an M2M client ' +
        'grant from the automation app to the API, the acme and globex organizations each with an enabled ' +
        'login connection, and an Org Admin invitation for admin@acme.example.com into acme — with every ' +
        'created resource captured in smoke-b2b-manifest.json and backed by the command trace?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
