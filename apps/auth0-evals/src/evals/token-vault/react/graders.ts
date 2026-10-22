import { contains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Connected Accounts symbols present ───────────────────
    // In a SPA, Token Vault is Connected Accounts only: the browser links the
    // provider account and the backend does the exchange. None of these
    // symbols exist in the scaffold, so each one is real evidence of work.
    contains(
      'connectAccountWithRedirect',
      'Links the Google account via useAuth0().connectAccountWithRedirect',
      GraderLevel.L1,
    ),
    contains('google-oauth2', 'Targets the google-oauth2 connection', GraderLevel.L1),
    // The My Account API token is minted with the refresh-token grant (MRRT)
    // and must be DPoP-bound — the SDK's Connected Accounts example sets all three.
    contains('useRefreshTokens', 'Enables useRefreshTokens on Auth0Provider', GraderLevel.L1),
    contains('useMrrt', 'Enables useMrrt (Multi-Resource Refresh Tokens) on Auth0Provider', GraderLevel.L1),
    contains('useDpop', 'Enables useDpop on Auth0Provider (My Account API requires DPoP)', GraderLevel.L1),
    // The connected-account result only reaches the app through the
    // provider's onRedirectCallback(appState) — the default handler drops it.
    contains('onRedirectCallback', 'Handles the connect return via Auth0Provider onRedirectCallback', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // The SPA SDK has no Token Vault exchange; a federated grant/token-type
    // literal means the model tried to get the Google token in the browser.
    notContainsInSource(
      'federated-connection-access-token',
      'No Token Vault exchange in the browser (the backend performs it)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'getAccessTokenForConnection',
      'No server-SDK getAccessTokenForConnection (does not exist in @auth0/auth0-react)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'getTokenForConnection',
      'No getTokenForConnection (deprecated auth-js API, not in the SPA SDK)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/me/v1/connected-accounts',
      'Does not hand-roll the My Account connected-accounts endpoints (SDK owns connect/complete)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/api/v2/users',
      'Does not read provider tokens from Management API user identities',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource('@auth0/nextjs-auth0', 'No wrong-SDK import (nextjs-auth0) in the React SPA', GraderLevel.L2, {
      ignoreComments: true,
    }),

    // ── L3: Security ──────────────────────────────────────────────────────
    // A SPA is a public client — no secret was given and none may appear.
    // (Domain and client ID are already inline in the scaffold's main.jsx, so
    // they are not checked here.)
    notContainsInSource('clientSecret', 'No clientSecret in a SPA (public client)', GraderLevel.L3, {
      ignoreComments: true,
    }),
    notContainsInSource('client_secret', 'No client_secret in a SPA (public client)', GraderLevel.L3, {
      ignoreComments: true,
    }),
    judge(
      'Does the browser code avoid obtaining, requesting, or holding the Google access token and avoid manually ' +
        'reading, logging, or persisting the Auth0 refresh token or access tokens (for example in localStorage, ' +
        'sessionStorage, or cookies), leaving token storage to the SDK, while treating it as acceptable to store or ' +
        'display non-secret connection metadata such as the connection name, granted scopes, or connected account id?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    judge(
      'Is Auth0Provider configured with useRefreshTokens, useMrrt, and useDpop enabled and with the ' +
        'https://api.barkbook.com audience kept in authorizationParams, so the SDK can mint a My Account API token ' +
        'through the refresh-token grant, with offline_access either requested explicitly in the login scope or ' +
        'left to the SDK, which adds it automatically when useRefreshTokens is on?',
      GraderLevel.L4,
    ),
    judge(
      'Does a "Connect Google Calendar" button, shown only to an authenticated user, call connectAccountWithRedirect ' +
        'obtained from useAuth0() with connection google-oauth2 and a scopes array containing the Google Calendar ' +
        'read-only scope, rather than starting the link automatically or through loginWithRedirect?',
      GraderLevel.L4,
    ),
    judge(
      'Does Auth0Provider receive an onRedirectCallback that reads appState.connectedAccount when the user returns ' +
        'from the connect flow and makes it available to the UI, so the app shows which account (for example the ' +
        'connection name) was connected, while still cleaning up the URL and handling a normal login return?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the solution use the current @auth0/auth0-react Connected Accounts API, passing the Google scopes through ' +
        'the top-level scopes option of connectAccountWithRedirect (available since 2.9.0), rather than ' +
        'hand-building requests to the My Account API, the /authorize endpoint, or /oauth/token, or passing provider ' +
        'scopes only through authorization_params?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Token Vault Connected Accounts to the React SPA using @auth0/auth0-react, ' +
        'configuring Auth0Provider with useRefreshTokens, useMrrt, and useDpop, linking the Google account with ' +
        'connectAccountWithRedirect for the google-oauth2 connection with calendar scopes on a user action, showing ' +
        'the connected account from appState.connectedAccount in onRedirectCallback, and leaving the Google token ' +
        'exchange to the backend instead of obtaining provider tokens in the browser?',
      undefined,
      {
        context:
          'The scaffold depends on @auth0/auth0-react ^2.13.0 (resolves to 2.28.x), backed by @auth0/auth0-spa-js. ' +
          'These APIs are real and MUST NOT be flagged as fabricated: const { connectAccountWithRedirect } = useAuth0(); ' +
          "connectAccountWithRedirect({ connection: 'google-oauth2', scopes: ['https://www.googleapis.com/auth/calendar.readonly'], " +
          'authorization_params?, redirectUri?, appState? }) returns Promise<void> (top-level scopes since 2.9.0). ' +
          'Auth0Provider props useRefreshTokens, useMrrt and useDpop are valid. On return the provider handles the ' +
          'connect_code callback itself and calls onRedirectCallback(appState) with appState.connectedAccount ' +
          '({ id, connection, scopes, created_at, ... }). Error classes ConnectError, MyAccountApiError and ' +
          'MissingRefreshTokenError are exported from @auth0/auth0-react. When useRefreshTokens is true the SDK ' +
          'injects offline_access into the scope automatically, so an explicit offline_access string is optional. ' +
          'The SPA SDKs have NO Token Vault exchange method: the backend (https://api.barkbook.com/calendar) performs ' +
          'the exchange, so a correct SPA never handles a Google access token. Domain and clientId hardcoded inline ' +
          'in main.jsx are pre-existing scaffold code and public SPA values; env-sourced values (import.meta.env.*) ' +
          'are equally correct. Calling the backend API is optional for this task. Grade from source only.',
      },
    ),
  ];
}
