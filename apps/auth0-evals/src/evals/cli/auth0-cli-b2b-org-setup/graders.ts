import { ranCommand, ranCommandOneOf, matches, judge, GraderLevel } from '@a0/evals-graders';

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
    //    Phrased so the correct answer is "yes": the judge's verdict is read as
    //    yes=pass / no=fail, so a "no secret must be exposed" assertion inverts.
    judge(
      'Are smoke-b2b-manifest.json and the command trace free of any Auth0 client secret ' +
        'value? Answer no only if an actual secret appears — for example one printed by ' +
        '`auth0 apps create` and then echoed, stored in the manifest, or passed on a later ' +
        'command line. client_ids and resource ids are not secrets, so a manifest carrying ' +
        'only those is fine. The harness masks credential values in the command trace as ' +
        '`[REDACTED SECRET]` so they never leave the machine, so treat that marker as a ' +
        'secret having been on that command line and answer no.',
      GraderLevel.L3,
      { includeCommandTrace: true },
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    //    Each grader asserts the endpoint/command an action MUST hit to be real
    //    (successful calls only); the judge below confirms the resulting outcome.
    //    The prompt names no command or flag, so the agent works out the CLI
    //    surface itself. Where a dedicated subcommand and a raw `auth0 api` call
    //    share an endpoint/resource substring, match that substring so either
    //    route counts — grade the effect, not one spelling of the command. Where
    //    they do not (`apis` vs `resource-servers`, `apps` vs `clients`, `orgs`
    //    vs `organizations`), list both routes and pin the resource with `args`.
    ranCommandOneOf(['auth0 apis create', 'resource-servers'], 'Created the protected API', GraderLevel.L4, [
      'Smoke API',
      'https://smoke.example.com',
    ]),
    // Route alternatives rather than the bare `roles` substring: `roles list | grep
    // "Org Admin"` would otherwise satisfy a grader about *creating* the role.
    ranCommandOneOf(['auth0 roles create', ['api post', 'roles']], 'Created the `Org Admin` role', GraderLevel.L4, [
      'Org Admin',
    ]),
    ranCommandOneOf(['auth0 roles create', ['api post', 'roles']], 'Created the `Org Member` role', GraderLevel.L4, [
      'Org Member',
    ]),
    // Permissions may be added in one comma-separated call or several, so no args —
    // the judge confirms the resulting permission sets. `auth0 api post/patch` reaches
    // the same sub-resource, and the read-only `permissions list` matches neither route.
    ranCommandOneOf(
      ['auth0 roles permissions add', ['api post', 'permissions'], ['api patch', 'permissions']],
      'Added API permission(s) to a role',
      GraderLevel.L4,
    ),
    ranCommandOneOf(['auth0 apps create', 'clients'], 'Created the Regular Web App `Smoke Portal`', GraderLevel.L4, [
      'Smoke Portal',
      'http://localhost:3000/callback',
    ]),
    ranCommandOneOf(['auth0 apps create', 'clients'], 'Created the M2M app `Smoke Automation`', GraderLevel.L4, [
      'Smoke Automation',
    ]),
    // `auth0 client-grants create` and `auth0 api post client-grants` both work, so
    // match the shared substring rather than either prefix; the judge confirms the
    // audience and scopes.
    ranCommand(
      'client-grants',
      undefined,
      'Created an M2M client grant against the client-grants endpoint',
      GraderLevel.L4,
    ),
    // Both args, not just the org name: `api post organizations/<id>/invitations`
    // also carries "acme" (inside admin@acme.example.com), so the display name is
    // what separates creating the org from acting on it. A run that creates the org
    // and sets its display name in a second call fails here and is caught by the
    // manifest judge instead.
    ranCommandOneOf(
      ['auth0 orgs create', ['api post', 'organizations']],
      'Created organization `acme`',
      GraderLevel.L4,
      ['acme', 'Acme Inc'],
    ),
    ranCommandOneOf(
      ['auth0 orgs create', ['api post', 'organizations']],
      'Created organization `globex`',
      GraderLevel.L4,
      ['globex', 'Globex Corp'],
    ),
    ranCommand('enabled_connections', undefined, 'Enabled a login connection on an organization', GraderLevel.L4),
    // `auth0 orgs invitations create` and `auth0 api post organizations/<id>/invitations`
    // are both real routes, so key off the resource plus the invitee rather than the
    // subcommand spelling — a correct run through `auth0 api` used to fail here.
    ranCommand('invitations', ['admin@acme.example.com'], 'Created the Org Admin invitation', GraderLevel.L4),
    // Reading state back is the assertion; which command did it is not. `auth0 api get`
    // counts — an agent that verifies entirely through the passthrough has still verified.
    ranCommandOneOf(
      [
        'auth0 apps list',
        'auth0 apis list',
        'auth0 roles list',
        'auth0 orgs list',
        'auth0 orgs show',
        'auth0 orgs members list',
        'auth0 connections list',
        'auth0 client-grants list',
        'auth0 api get',
      ],
      'Read the tenant state back to confirm the setup',
      GraderLevel.L4,
    ),
    // Assert the file landed in the workspace, not which tool put it there:
    // `wroteFile` only sees write_file/write/edit calls, so it fails an agent that
    // used a `>` redirect — and avoiding that meant telling the agent which tool to
    // use, which is not something the task should have to spell out.
    matches(
      '^// FILE: smoke-b2b-manifest\\.json$',
      'Left the B2B manifest at `smoke-b2b-manifest.json`',
      GraderLevel.L4,
    ),
    judge(
      'Is smoke-b2b-manifest.json present, valid JSON, and does it describe the required B2B ' +
        '(organizations) Auth0 setup? Answer yes ONLY if ALL of the following hold. ' +
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
        'Every id/client_id/grant id field should be a non-empty string. Answer no if the file is ' +
        'missing, is not valid JSON, or any of these is absent or inconsistent. A `// COMMAND TRACE` ' +
        'section lists the shell commands the agent actually ran; use it to confirm the manifest ' +
        'values are backed by real `auth0` commands (API, roles, apps, client grant, orgs, enabled ' +
        'connections, invitation) and not fabricated. Dedicated subcommands and `auth0 api` calls ' +
        'both count as real commands.',
      GraderLevel.L4,
      { includeCommandTrace: true },
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────────
    judge(
      'Does the solution correctly configure the entire B2B organizations setup for the Smoke product ' +
        'through the `auth0` CLI: a protected API with the three scopes, the Org Admin and Org Member ' +
        'roles wired to those scopes, a regular-web portal app and an M2M automation app, an M2M client ' +
        'grant from the automation app to the API, the acme and globex organizations each with an enabled ' +
        'login connection, and an Org Admin invitation for admin@acme.example.com into acme — with every ' +
        'created resource captured in smoke-b2b-manifest.json and backed by the command trace? ' +
        'Judge the end state, not the route taken: `auth0 api ...` is part of the CLI, so reaching the ' +
        'Management API through it is fully acceptable and must not be penalized, whether or not a ' +
        'dedicated subcommand also exists. Do not assume a subcommand exists unless the trace shows it ' +
        'running successfully.',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
