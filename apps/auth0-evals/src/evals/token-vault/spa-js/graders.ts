import { contains, matches, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Connected Accounts symbols present ───────────────────
    contains(
      'connectAccountWithRedirect',
      'Links the Google account via the SDK connectAccountWithRedirect method',
      GraderLevel.L1,
    ),
    // The My Account API token behind Connected Accounts is minted from a refresh
    // token (MRRT) and DPoP-bound — the SDK's Token Vault example enables all three.
    contains('useRefreshTokens', 'Enables useRefreshTokens on the Auth0 client', GraderLevel.L1),
    contains('useMrrt', 'Enables useMrrt (multi-resource refresh token) on the Auth0 client', GraderLevel.L1),
    contains('useDpop', 'Enables useDpop on the Auth0 client', GraderLevel.L1),
    contains('google-oauth2', 'Targets the google-oauth2 connection', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // In-source with comments stripped: a design note saying "the backend does the
    // federated-connection-access-token exchange" is not a hallucination.
    notContainsInSource(
      'federated-connection-access-token',
      'No Token Vault exchange attempted in the browser — the backend performs it',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'getAccessTokenForConnection',
      'No server-SDK getAccessTokenForConnection call — it does not exist in auth0-spa-js',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'getTokenForConnection',
      'No auth0-auth-js getTokenForConnection call — it does not exist in auth0-spa-js',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/me/v1/connected-accounts',
      'Does not hand-roll the My Account connected-accounts endpoints — the SDK drives connect/complete',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource('@auth0/auth0-react', 'No React SDK in a vanilla JS app', GraderLevel.L2, {
      ignoreComments: true,
    }),

    // ── L3: Security ──────────────────────────────────────────────────────
    // A SPA is a public client — no secret was given and none may appear.
    notContainsInSource('clientSecret', 'No clientSecret in an SPA (public client)', GraderLevel.L3, {
      ignoreComments: true,
    }),
    notContainsInSource('client_secret', 'No client_secret in an SPA (public client)', GraderLevel.L3, {
      ignoreComments: true,
    }),
    judge(
      'Does the browser code avoid obtaining, logging, or persisting by hand any Google access token or Auth0 ' +
        'refresh token (no attempt to fetch the provider token client-side, no console logging of tokens, no ' +
        'manual localStorage/sessionStorage/cookie token storage), while treating as acceptable the display of ' +
        'connection metadata (connection name, scopes, connected account id), the calendar events returned by ' +
        'the Barkbook backend, and the token caching the auth0-spa-js SDK performs itself?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(
      // Either order: an inline options object, or options built in a variable before the call.
      String.raw`connectAccountWithRedirect\([\s\S]{0,200}connection|connection[\s\S]{0,200}connectAccountWithRedirect\(`,
      'Calls connectAccountWithRedirect with an options object naming the connection',
      GraderLevel.L4,
    ),
    judge(
      'Does a user action (the "Connect Google Calendar" button) call auth0Client.connectAccountWithRedirect ' +
        'with connection set to google-oauth2 and a Google Calendar read scope (passed as scopes), on a client ' +
        'created with useRefreshTokens, useMrrt, and useDpop enabled, with offline_access either requested explicitly ' +
        'or left to the SDK, which injects it automatically when useRefreshTokens is on?',
      GraderLevel.L4,
    ),
    judge(
      'When the user returns from connecting their account, does the app detect the connect callback ' +
        '(the connect_code and state query parameters, for example via an explicit connect_code check or a ' +
        'callback check that also matches it, optionally also handling an error parameter), call ' +
        'handleRedirectCallback(), and read the connected account (for example its connection) from the ' +
        'value handleRedirectCallback returns rather than from the return value of connectAccountWithRedirect?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the solution link the account through the current auth0-spa-js connectAccountWithRedirect API, ' +
        'passing the provider scopes via the top-level scopes option, rather than hand-building a request to ' +
        'the My Account API, using the Management API, or trying to exchange for the Google token in the browser?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Token Vault Connected Accounts to the vanilla JavaScript SPA using ' +
        '@auth0/auth0-spa-js — configuring the client with useRefreshTokens, useMrrt, and useDpop, ' +
        'linking Google via connectAccountWithRedirect({ connection: "google-oauth2", scopes }), handling the ' +
        'connect_code return through handleRedirectCallback to show the connected account, and loading calendar ' +
        'events from the Barkbook backend with the normal Auth0 access token instead of obtaining a Google token ' +
        'in the browser?',
      undefined,
      {
        context:
          'the scaffold pins @auth0/auth0-spa-js ^2.0.0, which resolves to the current 2.x. Connected Accounts ' +
          'support exists since 2.6.0 and the top-level `scopes` option since 2.9.0. ' +
          '`auth0Client.connectAccountWithRedirect({ connection, scopes?, authorization_params?, redirectUri?, ' +
          'appState?, openUrl? }): Promise<void>` is a real Auth0Client method (src/Auth0Client.ts) — it ' +
          'redirects and returns nothing. On return the URL carries `?connect_code=...&state=...` (not `code=`), ' +
          'and `handleRedirectCallback()` returns a `ConnectAccountRedirectResult` with `id`, `connection`, ' +
          '`scopes`, `created_at`, `appState` and `response_type: "connect_code"`. The callback check must ' +
          "actually match `connect_code`: an explicit `connect_code` check, or the scaffold's raw substring " +
          'check `query.includes("code=")` (which also matches `connect_code=`), is correct; a parsed check ' +
          'such as `URLSearchParams.has("code")` or `.get("code")` alone does NOT match `connect_code` and skips ' +
          'handleRedirectCallback() for the connect return, so it is incorrect. ' +
          '`createAuth0Client({ useRefreshTokens: true, useMrrt: true, useDpop: true, authorizationParams: { ' +
          'audience, scope: "openid profile email offline_access" } })` is the documented setup (examples/token-vault.md); ' +
          'with useRefreshTokens: true the SDK injects offline_access itself (src/Auth0Client.ts:332-338), so an ' +
          'explicit offline_access string is optional. ' +
          'Errors: `ConnectError`, `MyAccountApiError`, and `GenericError` codes `missing_connect_code` / ' +
          '`state_mismatch`. These are real APIs, not hallucinations. The SPA SDK has NO method that returns ' +
          'the Google access token — the backend performs the Token Vault exchange, so the SPA calls ' +
          'https://api.barkbook.com/calendar with its normal Auth0 access token from getTokenSilently(). ' +
          'Domain, client id and audience may be inline (as in the scaffold) or read from import.meta.env; ' +
          'both are correct. Grade from source files only.',
      },
    ),
  ];
}
