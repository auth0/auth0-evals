import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Token Vault / Connected Accounts symbols present ───────
    contains('start_connect_account', 'Starts the Connected Accounts flow via start_connect_account', GraderLevel.L1),
    contains('ConnectAccountOptions', 'Builds a typed ConnectAccountOptions for the connect call', GraderLevel.L1),
    contains(
      'complete_connect_account',
      'Completes the Connected Accounts callback via complete_connect_account',
      GraderLevel.L1,
    ),
    contains(
      'get_access_token_for_connection',
      'Exchanges for the Google token via get_access_token_for_connection',
      GraderLevel.L1,
    ),
    contains('google-oauth2', 'Targets the google-oauth2 connection', GraderLevel.L1),
    contains(
      'offline_access',
      'Requests offline_access so the session holds a refresh token (scaffold scope lacks it)',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContainsInSource(
      'grant-type:token-exchange:federated-connection-access-token',
      'No hand-rolled federated-connection token-exchange grant — the SDK issues the /oauth/token call',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/me/v1/connected-accounts',
      'No raw My Account API connected-accounts calls — use start/complete_connect_account',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/api/v2/users',
      'No Management API user/identities lookup for provider tokens (pre-Token-Vault workaround)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'getAccessTokenForConnection',
      'No camelCase JS method name — auth0-server-python is snake_case',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ────────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded Auth0 client secret in source (allowed only in .env)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code keep the Google access token and the Auth0 refresh token on the server — never returning ' +
        'them in an HTTP response body, header, or redirect, never logging them, and never persisting them by hand ' +
        'in its own cookie, file, or database instead of relying on the SDK state store — while treating returning ' +
        'the Google Calendar event results or non-secret connection metadata (connection name, scopes, connected ' +
        'account id) to the browser as acceptable?',
      GraderLevel.L3,
      {
        context:
          'FLAG: the Google (provider) access token or the Auth0 refresh token sent to the browser, logged, or ' +
          'stored by hand; a hardcoded client secret in source. NOT a violation: returning the list of calendar ' +
          'events or connection metadata; configuration read from os.environ / .env; the scaffold-provided ' +
          'encrypted CookieStateStore / CookieTransactionStore, which is the SDK state store.',
      },
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    matches(
      // Either order: an inline options dict, or options built in a variable before the call.
      String.raw`get_access_token_for_connection\([\s\S]{0,200}connection|connection[\s\S]{0,200}get_access_token_for_connection\(`,
      'Passes the connection to get_access_token_for_connection in its options dict',
      GraderLevel.L4,
    ),
    judge(
      'Does the connect action await start_connect_account with a ConnectAccountOptions for the google-oauth2 ' +
        'connection (plus store_options) and redirect the user to the returned URL, and does the callback that ' +
        'receives the connect_code return pass the full callback URL with store_options to ' +
        'complete_connect_account before sending the user back into the app?',
      GraderLevel.L4,
      {
        context:
          'Either design is correct: a dedicated connect-callback route whose URL is passed as redirect_uri in ' +
          'ConnectAccountOptions, or the existing /auth/callback branching on the connect_code query parameter ' +
          '(connect_code goes to complete_connect_account, code goes to complete_interactive_login). The full ' +
          'URL including query string is req.url in this scaffold; store options are built by _opts(req, res). ' +
          'scopes on ConnectAccountOptions (for example a Google Calendar read scope) are optional but welcome. ' +
          'DPoP is not required for this server SDK.',
      },
    ),
    judge(
      'Does the /calendar route await get_access_token_for_connection with the google-oauth2 connection and ' +
        'store_options, use the returned string directly as an Authorization Bearer token when calling the Google ' +
        'Calendar events API server-side, ensure the login requests offline_access, and handle ' +
        'AccessTokenForConnectionError (for example by prompting the user to log in again or reconnect Google) ' +
        'instead of crashing?',
      GraderLevel.L4,
      {
        context:
          'In auth0-server-python, get_access_token_for_connection({"connection": ..., "login_hint"?: ...}, ' +
          'store_options=...) returns a str (the provider access token), not a dict — indexing it with ' +
          '["access_token"] or reading .access_token is wrong. It raises AccessTokenForConnectionError ' +
          '(from auth0_server_python.error, code for example missing_refresh_token). offline_access may be added ' +
          'either in auth0_client.py authorization_params.scope or via authorization_params passed to ' +
          'start_interactive_login in app.py; both are correct. Catching a broader Auth0Error base is acceptable.',
      },
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the code use the auth0-server-python Token Vault and Connected Accounts methods (start_connect_account ' +
        'with ConnectAccountOptions, complete_connect_account, get_access_token_for_connection) on the existing ' +
        'ServerClient rather than hand-rolling POSTs to /oauth/token or the My Account API, or reading provider ' +
        'tokens from Management API user identities?',
      GraderLevel.L5,
      {
        context:
          'These are the current snake_case auth0-server-python APIs (Connected Accounts since 1.0.0b6; the ' +
          'scaffold pins >=1.0.0b17). ConnectAccountOptions lives in auth0_server_python.auth_types. ' +
          'get_token_for_connection is a lower-level SDK method and is acceptable but less idiomatic.',
      },
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Token Vault to the Python web app using auth0-server-python — linking the ' +
        "user's Google account through start_connect_account and complete_connect_account, requesting " +
        'offline_access, and serving /calendar by exchanging via get_access_token_for_connection for google-oauth2 ' +
        'and calling the Google Calendar events API server-side, without exposing provider or refresh tokens?',
      undefined,
      {
        context:
          'Real auth0-server-python API surface: await auth0.start_connect_account(ConnectAccountOptions(' +
          'connection=, redirect_uri=, scopes=, app_state=, authorization_params=), store_options=) returns the ' +
          'connect URL str; await auth0.complete_connect_account(url, store_options=) returns ' +
          'CompleteConnectAccountResponse; await auth0.get_access_token_for_connection({"connection": ..., ' +
          '"login_hint"?: ...}, store_options=) returns a str; errors AccessTokenForConnectionError and ' +
          'MyAccountApiError from auth0_server_python.error. A refresh token (offline_access scope) is required. ' +
          'Config from os.environ / .env is correct. These are real symbols, not hallucinations.',
      },
    ),
  ];
}
