import { ranCommand, ranCommandOneOf, ranCommandsInOrder, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk - grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
// Tests org creation, enabling a database connection for the org with
// auto-membership, and configuring the SPA to require org login.
export function defineGraders() {
  return [
    // ── L2: Hallucination - agent must NOT configure SAML ─────────────────
    // for a basic org setup that uses a database connection
    notRanCommand(
      'saml',
      'Did not configure SAML connections for a basic username/password org setup',
      GraderLevel.L2,
    ),

    // ── L4: Organization created ──────────────────────────────────────────
    // Accept either CLI form: the `auth0 orgs create` subcommand or the
    // `auth0 api post organizations` passthrough. Key the subcommand form on
    // `orgs create --name`/`-n` (an actual create), not bare `orgs create` —
    // that would also match an `orgs create --help` probe, which creates nothing.
    ranCommandOneOf(
      ['orgs create --name', 'orgs create -n', 'api post organizations'],
      'Created an organization via `auth0 orgs create` or `auth0 api post organizations`',
      GraderLevel.L4,
    ),

    // ── L4: Connection enabled for organization with auto-membership ───────
    // Pin the value to `true` - the task requires auto-assignment, and matching
    // the bare key would also pass for `assign_membership_on_login: false`.
    ranCommand(
      'enabled_connections',
      ['assign_membership_on_login', 'true'],
      'Enabled connection with auto-membership (true) for the organization',
      GraderLevel.L4,
    ),

    // ── L4: Application configured to require organization login ──────────
    // Quote the value: the bare substring `require` also appears inside
    // `organization_require_behavior`, so it would pass even when
    // organization_usage is `allow`/`deny`. `"require"` only matches the value.
    ranCommand(
      'clients',
      ['organization_usage', '"require"'],
      'Configured application with organization_usage set to require',
      GraderLevel.L4,
    ),

    // ── L4: The acme-corp organization created before connections enabled ──
    // Key step 1 on `acme-corp` rather than `organizations`: the enable call's
    // own URL (organizations/{id}/enabled_connections) contains both needles in
    // order, so keying on `organizations` would pass without a real create step.
    ranCommandsInOrder(
      ['acme-corp', 'enabled_connections'],
      'acme-corp organization created before enabling its connections',
      GraderLevel.L4,
    ),

    // ── L5: Correct pre-login prompt behavior set ─────────────────────────
    ranCommand(
      'clients',
      ['organization_require_behavior', 'pre_login_prompt'],
      'Set organization_require_behavior to pre_login_prompt',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level - always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution: ' +
        '(1) create an organization with name "acme-corp" and display name "Acme Corp"; ' +
        '(2) enable the "Username-Password-Authentication" connection for that organization ' +
        'with assign_membership_on_login set to true; ' +
        '(3) configure the Single Page Application with organization_usage set to "require" and ' +
        'organization_require_behavior set to "pre_login_prompt" - ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
