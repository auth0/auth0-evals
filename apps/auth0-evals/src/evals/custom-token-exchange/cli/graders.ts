import { ranCommandOneOf, ranCommandsInOrder, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into, with a custom API, a database connection, and the
// "Partner Exchange" M2M app pre-seeded (see scaffold/seed.sh). The agent writes
// nothing to disk — grading leans on event graders (command trace) plus a
// trace-aware judge. Each grader accepts both routes the CLI offers: the native
// subcommand and the `auth0 api` Management passthrough.
export function defineGraders() {
  return [
    // ── L2: Hallucination — must NOT configure the delegation profile type ──
    // on_behalf_of_token_exchange is the actor-token / delegation path, out of
    // scope for a straight custom-authentication exchange.
    notRanCommand(
      'on_behalf_of_token_exchange',
      'Did not configure the delegation (on_behalf_of) profile type for a basic custom-authentication exchange',
      GraderLevel.L2,
    ),

    // ── L4: Enable Custom Token Exchange on the "Partner Exchange" app ───────
    // Native `auth0 apps update ... --allow-any-profile-of-type custom_authentication`
    // or the `auth0 api patch clients/<id>` passthrough carrying the same value.
    ranCommandOneOf(
      ['apps update', ['api patch', 'clients']],
      'Enabled custom_authentication token exchange on the application',
      GraderLevel.L4,
      ['custom_authentication'],
    ),

    // ── L4: Create an Action on the custom-token-exchange trigger ────────────
    ranCommandOneOf(
      ['actions create', ['api post', 'actions']],
      'Created an Action on the custom-token-exchange trigger',
      GraderLevel.L4,
      ['custom-token-exchange'],
    ),

    // ── L4: Register the token-exchange profile for the partner token type ──
    ranCommandOneOf(
      ['token-exchange create', 'token-exchange-profiles'],
      'Registered a token-exchange profile for subject_token_type urn:barkbook:external-idp-token',
      GraderLevel.L4,
      ['urn:barkbook:external-idp-token'],
    ),

    // ── L4: Action created before the profile that references its action_id ──
    ranCommandsInOrder(
      [
        ['actions create', 'actions/actions'],
        ['token-exchange create', 'token-exchange-profiles'],
      ],
      'Created the Action before the profile that references it',
      GraderLevel.L4,
    ),

    // ── L5: Profile is a custom_authentication profile ───────────────────────
    ranCommandOneOf(
      ['token-exchange create', 'token-exchange-profiles'],
      'Token-exchange profile is of type custom_authentication',
      GraderLevel.L5,
      ['custom_authentication'],
    ),

    // ── Holistic judge (no level — always runs) ──────────────────────────────
    judge(
      'Based on the command trace, does the solution: ' +
        '(1) enable Custom Token Exchange on the "Partner Exchange" application by allowing the ' +
        'custom_authentication profile type (apps update --allow-any-profile-of-type custom_authentication, ' +
        'or the clients Management API equivalent); ' +
        '(2) create an Action on the custom-token-exchange trigger that validates the partner token and ' +
        'resolves the user into the Username-Password-Authentication connection; ' +
        '(3) register a token-exchange profile of type custom_authentication for subject_token_type ' +
        'urn:barkbook:external-idp-token that points at that Action — ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
