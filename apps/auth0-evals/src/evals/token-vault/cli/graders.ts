import { ranCommand, ranCommandsInOrder, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into, with the "Barkbook Web" app and a `google-oauth2`
// connection pre-seeded and reset to a Token-Vault-off baseline (see
// scaffold/seed.sh). The agent writes nothing to disk — grading leans on event
// graders (command trace) plus a trace-aware judge.
//
// `auth0 apps update --grants` does not map the Token Vault grant, so the app is
// changed through a JSON body — native `auth0 apps update <id> --data` /
// `--refresh-token`, or the `auth0 api patch clients/<id>` passthrough. The
// connection is the same: `auth0 connections update <id> --data` or
// `auth0 api patch connections/<id>`. Each grader accepts both routes.
const TOKEN_VAULT_GRANT = 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token';

export function defineGraders() {
  return [
    // ── L2: Hallucination — Token Vault is not Custom Token Exchange ────────
    // Token-exchange profiles back Custom Token Exchange (an Action validates a
    // third-party token); Token Vault needs no profile at all.
    notRanCommand(
      'token-exchange-profiles',
      'Did not create a Custom Token Exchange profile — Token Vault needs none',
      GraderLevel.L2,
    ),

    // ── L2: Hallucination — the generic RFC 8693 grant is not the Token Vault grant ──
    // The Token Vault grant is the Auth0-specific federated-connection URN; the
    // standard `urn:ietf:...:token-exchange` grant does not retrieve vaulted tokens.
    notRanCommand(
      'urn:ietf:params:oauth:grant-type:token-exchange',
      'Did not use the generic RFC 8693 token-exchange grant instead of the Token Vault grant',
      GraderLevel.L2,
    ),

    // ── L4: Allow the app to perform the Token Vault exchange ───────────────
    // Matches on the grant itself so `apps update --data` and `api patch clients`
    // both count. resolveWriteRefs: the body is often written with the write tool
    // and applied via `--data @file`, so the grant may live only in the write call.
    ranCommand(TOKEN_VAULT_GRANT, undefined, 'Added the Token Vault grant to the application', GraderLevel.L4, {
      resolveWriteRefs: true,
    }),

    // ── L4: Read before write — grant_types is replaced, not merged ─────────
    // PATCHing grant_types with only the Token Vault grant drops the app's
    // existing authorization_code / refresh_token grants, so the current list
    // must be read first.
    ranCommandsInOrder(
      [
        ['get clients', 'get "clients', "get 'clients", 'apps show'],
        ['apps update', 'patch clients', 'patch "clients', "patch 'clients"],
      ],
      'Read the application before patching grant_types (merge, not clobber)',
      GraderLevel.L4,
    ),

    // ── L4: Turn Token Vault on for the Google connection ───────────────────
    ranCommand(
      'connections',
      ['connected_accounts', 'true'],
      'Enabled Token Vault (connected_accounts.active) on the google-oauth2 connection',
      GraderLevel.L4,
      { resolveWriteRefs: true },
    ),

    // ── L4: Refresh-token exchange requires non-rotating refresh tokens ─────
    // Seed sets rotation_type "rotating"; Token Vault's refresh-token exchange
    // requires rotation to be disabled.
    ranCommand(
      'rotation_type',
      ['non-rotating'],
      'Disabled refresh token rotation on the application',
      GraderLevel.L4,
      { resolveWriteRefs: true },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution: ' +
        '(1) enable Token Vault on the google-oauth2 connection by setting connected_accounts.active = true ' +
        '(auth0 connections update --data, or the connections Management API equivalent); ' +
        `(2) add the ${TOKEN_VAULT_GRANT} grant to the "Barkbook Web" application's grant_types while keeping ` +
        'its existing authorization_code and refresh_token grants (reading the client first rather than ' +
        'replacing grant_types with only the new grant); ' +
        '(3) make the application\'s refresh tokens non-rotating (refresh_token.rotation_type = "non-rotating"), ' +
        'since the refresh-token exchange does not work with rotation — ' +
        'without creating Custom Token Exchange profiles or Actions, and using only the Auth0 CLI, ' +
        'not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
