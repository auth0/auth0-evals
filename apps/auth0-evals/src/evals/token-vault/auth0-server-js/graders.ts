import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Token Vault symbols present ────────────────────────────
    // The scaffold already has offline_access in its login scope, so it is not asserted here.
    contains(
      'getAccessTokenForConnection',
      'Calls ServerClient.getAccessTokenForConnection for the vaulted provider token',
      GraderLevel.L1,
    ),
    contains('google-oauth2', 'Targets the google-oauth2 connection', GraderLevel.L1),
    matches(
      String.raw`googleapis\.com/calendar|google\.calendar\(`,
      'Calls the Google Calendar API (REST endpoint or googleapis client)',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    // AccessTokenForConnectionError appears only in server-js JSDoc; the thrown class is
    // auth-js TokenForConnectionError (server-client.ts:1462 vs 1522).
    notContainsInSource(
      'AccessTokenForConnectionError',
      'No AccessTokenForConnectionError — that class does not exist in @auth0/auth0-server-js',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'grant-type:token-exchange:federated-connection-access-token',
      'No hand-rolled Token Vault grant — the SDK builds the /oauth/token request',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'oauth/token-type/federated-connection-access-token',
      'No hand-rolled requested_token_type URN — the SDK sets it',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/api/v2/users',
      'No Management API identities lookup for provider tokens (pre-Token-Vault workaround)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/me/v1/connected-accounts',
      'No hand-rolled My Account Connected Accounts calls',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '.getTokenForConnection(',
      'No deprecated auth-js getTokenForConnection — use the ServerClient method',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ────────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code keep the Google access token and the Auth0 refresh token on the server — never returning ' +
        'them in a JSON response, a rendered page, a cookie it sets by hand, or a log line, and never persisting ' +
        'them in its own database, file, or module-level variable instead of relying on the SDK session cache?',
      GraderLevel.L3,
      {
        context:
          'FLAG: the Google (provider) access token or the Auth0 refresh token sent to the browser or caller, ' +
          'logged (console.log and friends), or stored by hand outside the SDK state store; a hardcoded client ' +
          'secret in source. NOT a violation: returning the Google Calendar API results (the event list) to the ' +
          'browser; returning connection metadata such as the connection name or scopes; the scaffold reading ' +
          'credentials from process.env; the SDK caching the token in its own session (connectionTokenSets in ' +
          'the encrypted StatelessStateStore cookie).',
      },
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project compiles (tsc succeeds)', GraderLevel.L4),
    matches(
      // Either order: an inline options object, or options built in a variable before the call.
      String.raw`getAccessTokenForConnection\([\s\S]{0,200}connection|connection[\s\S]{0,200}getAccessTokenForConnection\(`,
      'Passes an options object with connection to getAccessTokenForConnection',
      GraderLevel.L4,
    ),
    judge(
      'Does the GET /calendar route call serverClient.getAccessTokenForConnection with { connection: ' +
        "'google-oauth2' } as the first argument and the Express { request, response } store options as the " +
        'second argument, then call the Google Calendar API server-side with the returned accessToken in an ' +
        'Authorization Bearer header?',
      GraderLevel.L4,
      {
        context:
          'Real signature: serverClient.getAccessTokenForConnection(options: { connection, loginHint? }, ' +
          'storeOptions?, requestOptions?) returning ConnectionTokenSet { accessToken, scope, expiresAt, ' +
          'connection, loginHint? }. The store options are required in this scaffold because the cookie ' +
          'handler reads the session from them. The connection name may come from a constant or env var. ' +
          'Using the googleapis client with the token set as OAuth2 credentials is equivalent to a Bearer ' +
          'header. Checking for a signed-in user first (getUser/getSession) is good but optional.',
      },
    ),
    judge(
      'Does the route handle a failed Token Vault exchange (no session, missing refresh token, or Auth0 ' +
        'rejecting the exchange) by catching the error and redirecting the user to /auth/login or returning ' +
        'a 401-style response, instead of letting the request crash with an unhandled rejection?',
      GraderLevel.L4,
      {
        context:
          'The SDK throws TokenForConnectionError from @auth0/auth0-auth-js (code token_for_connection_error, ' +
          "name 'TokenForConnectionErrorCode'); @auth0/auth0-server-js does not re-export it. Acceptable: " +
          'importing TokenForConnectionError from @auth0/auth0-auth-js and using instanceof, checking ' +
          "err.code === 'token_for_connection_error', or a generic try/catch around the exchange that sends " +
          'the user to login. A separate check that redirects unauthenticated users before the exchange is ' +
          'also fine. AccessTokenForConnectionError does not exist in this SDK.',
      },
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the solution obtain the Google token through the ServerClient getAccessTokenForConnection method ' +
        '(which reads the refresh token from the SDK session and caches the result) rather than constructing a ' +
        'separate AuthClient, calling the deprecated getTokenForConnection, or hand-building a POST to ' +
        '/oauth/token?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add a GET /calendar route to the Express app that uses ' +
        "@auth0/auth0-server-js Token Vault to get the signed-in user's Google access token, calls the Google " +
        'Calendar API server-side with it, returns only the event data, and sends the user back to login when ' +
        'the token cannot be obtained?',
      undefined,
      {
        context:
          'Real API: serverClient.getAccessTokenForConnection({ connection, loginHint? }, storeOptions) returns ' +
          'ConnectionTokenSet { accessToken, scope, expiresAt, connection, loginHint? } and throws ' +
          'TokenForConnectionError (exported by @auth0/auth0-auth-js, not by @auth0/auth0-server-js; code ' +
          'token_for_connection_error). AccessTokenForConnectionError does NOT exist in this SDK. The scaffold ' +
          'already requests offline_access, so the session holds a refresh token; removing offline_access from ' +
          'the scope would break the exchange. Config read from process.env is correct. Google Calendar events ' +
          'endpoint: https://www.googleapis.com/calendar/v3/calendars/primary/events. Grade from source only.',
      },
    ),
  ];
}
