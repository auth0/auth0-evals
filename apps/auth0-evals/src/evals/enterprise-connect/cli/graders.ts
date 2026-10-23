import { ranCommand, ranCommandOneOf, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. Nothing is seeded — the agent creates every resource.
// The agent writes nothing to disk, so grading leans on event graders (command
// trace) plus a trace-aware judge.
// Tests a B2B Connect – Enterprise "Custom Authorization Server" integration
// (a client carrying b2b_integration_configuration.integration_type
// custom_auth_server) plus onboarding: an organization granted access to that
// client and a Self-Service Enterprise Configuration (SSEC) SSO ticket.
//
// The CLI has no dedicated B2B, self-service-profile or sso-ticket verb, and no
// `apps` flag for b2b_integration_configuration — those ride `apps create/update
// --data` or the `auth0 api` Management passthrough. Each grader accepts both.
const CLIENT_ROUTES = ['apps create', 'apps update', ['api', 'clients']];

// Shared judge context. Resource IDs only exist at runtime, so judges compare
// IDs across commands rather than expecting literal values.
const CLI_CONTEXT =
  'Accept either the native auth0 subcommand or the `auth0 api` Management API passthrough for every step, ' +
  'including JSON bodies sent with --data inline, from a file, or from stdin. Resource IDs are created at ' +
  'runtime, so judge whether the IDs used in later commands match the resources created earlier, not their ' +
  'literal values. Only successful commands count.';

export function defineGraders() {
  return [
    // ── L2: Hallucination — no refresh token for the integration ──────────
    // B2B Connect is stateless passthrough and issues no refresh tokens. Guard
    // both spellings: the CLI's `--grants refresh-token` and the raw API value
    // `"refresh_token"` (a grant_types entry or a refresh_token config object).
    // Quoting the API form keeps it off `auth0 refresh-tokens`-style probes.
    notRanCommand(
      'refresh-token',
      'Did not request the refresh-token grant for the integration (CLI flag form)',
      GraderLevel.L2,
    ),
    notRanCommand(
      '"refresh_token"',
      'Did not configure refresh_token on the integration (Management API form)',
      GraderLevel.L2,
    ),
    notRanCommand('offline_access', 'Did not request offline_access for a stateless passthrough', GraderLevel.L2),

    // ── L2: Hallucination — wrong B2B integration type ────────────────────
    // integration_type is custom_auth_server | third_party | application. Quote
    // the values so `third_party_security_mode` / `third_party_client_access_config`
    // and `application/json` headers don't trip the check.
    notRanCommand('"third_party"', 'Did not register the integration as a third-party managed server', GraderLevel.L2),
    notRanCommand('"application"', 'Did not register the integration as the direct Application type', GraderLevel.L2),

    // ── L4: Client registered as a Custom Authorization Server integration ─
    // The B2B marker is what makes the client a B2B Connect integration; a plain
    // regular web app with the right callback is the plausible-but-wrong answer.
    ranCommandOneOf(
      CLIENT_ROUTES,
      'Registered the client as a B2B Connect custom_auth_server integration',
      GraderLevel.L4,
      ['b2b_integration_configuration', 'custom_auth_server'],
    ),

    // ── L4: Callback is the authorization server's own callback ───────────
    // Accept the `--callbacks` flag or a `callbacks` array in the JSON body.
    ranCommandOneOf(
      CLIENT_ROUTES,
      "Set the integration callback to the authorization server's callback URL",
      GraderLevel.L4,
      ['https://auth.barkbook.com/oauth2/callback/auth0'],
    ),

    // ── L4: Confidential regular web client ───────────────────────────────
    // `--type regular` or `"app_type":"regular_web"` — both contain `regular`.
    ranCommandOneOf(
      CLIENT_ROUTES,
      'Created the integration as a confidential regular web application',
      GraderLevel.L4,
      ['regular'],
    ),

    // ── L4: Grant types set explicitly ────────────────────────────────────
    // `auth0 apps create --type regular` without `--grants` defaults to implicit,
    // authorization_code, refresh_token and client_credentials, so an agent that
    // never mentions refresh tokens still hands the integration one. Paired with
    // the L2 refresh-token checks above, this pins the grants to what was asked.
    ranCommandOneOf(
      [
        ['apps create', '--grants'],
        ['apps create', '-g '],
        ['apps update', '--grants'],
        ['apps update', '-g '],
        ['apps', 'grant_types'],
        ['clients', 'grant_types'],
      ],
      'Set the integration grant types explicitly instead of taking the CLI defaults',
      GraderLevel.L4,
    ),

    // ── L4: Organization created ──────────────────────────────────────────
    // Native `orgs create --name`/`-n` (not a bare `orgs create --help` probe)
    // or the `organizations` passthrough, keyed on the requested identifier.
    // The passthrough needs `--data` or an explicit `post` (stdin body) so a
    // read-only lookup piped through `jq` — which exits 0 on no match — can't pass.
    ranCommandOneOf(
      ['orgs create --name', 'orgs create -n', ['api', 'organizations', '--data'], ['api', 'post', 'organizations']],
      'Created the acme-corp organization',
      GraderLevel.L4,
      ['acme-corp'],
    ),
    ranCommandOneOf(
      ['orgs create', 'orgs update', 'organizations'],
      'Set the organization display name to "Acme Corp"',
      GraderLevel.L4,
      ['Acme Corp'],
    ),

    // ── L4: Organization granted access to the integration client ─────────
    // POST organizations/<id>/clients with a client_id body. No CLI verb exists.
    // `client_id` keeps a read-only `get organizations/<id>/clients` from passing;
    // `/clients` is not a substring of `/client-grants`.
    ranCommand(
      'organizations/',
      ['/clients', 'client_id'],
      'Granted the organization access to the integration client',
      GraderLevel.L4,
    ),

    // ── L4: SSEC SSO ticket generated ─────────────────────────────────────
    // Only successful commands are graded, and a bare tenant has no profiles,
    // so a ticket also proves a self-service profile was created first.
    ranCommand(
      'self-service-profiles/',
      ['sso-ticket'],
      'Generated a self-service SSO ticket from an SSEC profile',
      GraderLevel.L4,
    ),

    // ── L4: Ticket scoped to the organization and the integration ─────────
    ranCommand(
      'sso-ticket',
      ['enabled_organizations', 'organization_id'],
      'Scoped the SSO ticket to the organization',
      GraderLevel.L4,
    ),
    ranCommand(
      'sso-ticket',
      ['enabled_clients'],
      'Enabled the resulting connection for the integration client',
      GraderLevel.L4,
    ),

    // ── L4: Ticket provisions the requested connection ────────────────────
    ranCommand(
      'sso-ticket',
      ['connection_config', 'acme-corp-sso'],
      'SSO ticket creates a new connection named acme-corp-sso',
      GraderLevel.L4,
    ),

    // ── L4: Trace judges — one per outcome so a failure names itself ──────
    // The substring graders above match each command on its own; these ask what
    // they can't — that the IDs line up across commands and the end state holds.
    judge(
      'Is the client carrying b2b_integration_configuration.integration_type custom_auth_server the same client ' +
        'whose callbacks include https://auth.barkbook.com/oauth2/callback/auth0, rather than the marker and the ' +
        'callback landing on two different clients?',
      GraderLevel.L4,
      { includeCommandTrace: true, context: CLI_CONTEXT },
    ),
    judge(
      'Does the integration client end up with the authorization code grant and without refresh_token, judging ' +
        'by the grant types actually sent to it (where `auth0 apps create --type regular` without --grants ' +
        'defaults to implicit, authorization_code, refresh_token and client_credentials)?',
      GraderLevel.L4,
      { includeCommandTrace: true, context: CLI_CONTEXT },
    ),
    judge(
      'Is the client granted access through organizations/{id}/clients the integration client, and is {id} the ' +
        'acme-corp organization created in this run?',
      GraderLevel.L4,
      { includeCommandTrace: true, context: CLI_CONTEXT },
    ),
    judge(
      'Does the SSO ticket come from a self-service profile created in this run, with enabled_organizations ' +
        'naming the acme-corp organization ID and enabled_clients naming the integration client ID?',
      GraderLevel.L4,
      { includeCommandTrace: true, context: CLI_CONTEXT },
    ),
    judge(
      "Does the agent's final reply give the user the ticket URL returned by the sso-ticket call?",
      GraderLevel.L4,
      { includeCommandTrace: true, source: 'both', context: CLI_CONTEXT },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, is the tenant set up as a B2B Connect Custom Authorization Server integration ' +
        'for https://auth.barkbook.com with acme-corp onboarded through a self-service SSO ticket, leaving the ' +
        "enterprise connection for Acme's admin to configure rather than creating one itself, using only the " +
        'Auth0 CLI and not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true, context: CLI_CONTEXT },
    ),
  ];
}
