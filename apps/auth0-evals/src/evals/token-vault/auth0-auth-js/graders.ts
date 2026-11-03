import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Token Vault symbols present ────────────────────────────
    contains('exchangeToken', 'Calls AuthClient#exchangeToken', GraderLevel.L1),
    contains('subjectTokenType', 'Sets the camelCase subjectTokenType option explicitly', GraderLevel.L1),
    contains(
      'urn:ietf:params:oauth:token-type:refresh_token',
      'Declares the subject token as a refresh token (the SDK defaults to access_token)',
      GraderLevel.L1,
    ),
    contains('google-oauth2', 'Targets the google-oauth2 Token Vault connection', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContainsInSource(
      'grant-type:token-exchange:federated-connection-access-token',
      'No hand-rolled Token Vault grant — exchangeToken builds the /oauth/token request',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/api/v2/users',
      'Does not read provider tokens off Management API user identities',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/me/v1/connected-accounts',
      'Does not hand-roll My Account API connected-accounts calls',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource('@auth0/auth0-react', 'No React SDK in a Node.js server app', GraderLevel.L2, {
      ignoreComments: true,
    }),

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
      'Does the new calendar code keep the Google access token obtained from Token Vault on the server — ' +
        'never returning it in the HTTP response, never logging it or the Auth0 refresh token, and never ' +
        'persisting either token in its own database, file, or cookie?',
      GraderLevel.L3,
      {
        context:
          'FLAG: the Google (provider) access token included in any JSON response or header sent to the caller; ' +
          'console.log/logger output of the Google access token or the Auth0 refresh token; writing either token ' +
          'to a database, file, cache, or cookie by hand; a hardcoded client secret in source. ' +
          'NOT a violation: returning the Google Calendar API results (the event list) or non-secret connection ' +
          'metadata (connection name, scopes, expiry) to the caller; logging a generic error message without ' +
          "token values; the scaffold's pre-existing /login route returning the Auth0 refresh token to its " +
          'trusted caller; reading domain, client id, and client secret from process.env.',
      },
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project compiles (tsc succeeds)', GraderLevel.L4),
    matches(
      // Either order: an inline options object, or options built in a variable before the call.
      String.raw`exchangeToken\([\s\S]{0,300}connection|connection[\s\S]{0,300}exchangeToken\(`,
      'Calls exchangeToken with a connection option (the Token Vault overload)',
      GraderLevel.L4,
    ),
    judge(
      'Does the POST /calendar/events handler call authClient.exchangeToken with connection google-oauth2, ' +
        'subjectToken set to the caller-supplied Auth0 refresh token, subjectTokenType explicitly set to ' +
        'urn:ietf:params:oauth:token-type:refresh_token, and no audience or resource option, then read the ' +
        'Google access token from the accessToken field of the returned TokenResponse?',
      GraderLevel.L4,
      {
        context:
          'In @auth0/auth0-auth-js 1.2.0+, AuthClient#exchangeToken(options: TokenVaultExchangeOptions) selects ' +
          'the Token Vault path when a connection key is present. TokenVaultExchangeOptions is ' +
          '{ connection, subjectToken, subjectTokenType?, requestedTokenType?, loginHint?, scope?, extra? }. ' +
          'subjectTokenType defaults to urn:ietf:params:oauth:token-type:access_token, so passing a refresh token ' +
          'without the refresh_token URN is a token-type mismatch. Passing audience or resource throws ' +
          'TokenExchangeError. The return is a camelCase TokenResponse { accessToken, expiresAt, scope?, ... }; ' +
          'with fullResponse: true it is { data: TokenResponse, response }, so reading data.accessToken is also ' +
          "correct. Passing the options via a local variable is fine. The scaffold's existing /login call passing " +
          'audience to getTokenByPassword is unrelated and correct. Optional scope or loginHint values are fine.',
      },
    ),
    judge(
      'Does the handler call the Google Calendar API server-side with the vaulted Google access token as an ' +
        'Authorization Bearer credential, reject a request with no refresh token with a 4xx, and catch ' +
        'TokenExchangeError (or a failed exchange) by returning an error status without leaking token values?',
      GraderLevel.L4,
      {
        context:
          'The provider endpoint is https://www.googleapis.com/calendar/v3/calendars/primary/events; calling it ' +
          'with fetch and an Authorization: Bearer header is the expected shape, and using the googleapis client ' +
          'library with the token set as its OAuth2 credential is also acceptable. Query parameters such as ' +
          'timeMin, orderBy, singleEvents, or maxResults are optional. TokenExchangeError is exported from ' +
          '@auth0/auth0-auth-js (code token_exchange_error, with an OAuth2 error on .cause); catching a generic ' +
          'error around exchangeToken and mapping it to 401/403/502 is acceptable. Handling a non-2xx Google ' +
          'response is a plus but not required.',
      },
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the solution use the current @auth0/auth0-auth-js Token Vault API — AuthClient#exchangeToken with a ' +
        'connection option — rather than the deprecated getTokenForConnection method or a hand-built ' +
        'token-exchange request to the Auth0 token endpoint?',
      GraderLevel.L5,
      {
        context:
          'getTokenForConnection({ connection, refreshToken|accessToken, loginHint }) and TokenForConnectionError ' +
          'are deprecated since @auth0/auth0-auth-js 1.2.0 (removal planned in v2.0); the replacement is ' +
          'exchangeToken({ connection, subjectToken, subjectTokenType }) with TokenExchangeError. Any fetch POST ' +
          'to https://<domain>/oauth/token with the federated-connection-access-token grant counts as hand-built.',
      },
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add a POST /calendar/events endpoint to the Node.js auth service that ' +
        'exchanges the caller-supplied Auth0 refresh token for the Google access token via ' +
        'AuthClient#exchangeToken with connection google-oauth2 and the refresh_token subjectTokenType, uses ' +
        'that token server-side to fetch the upcoming events from the primary Google Calendar, and returns ' +
        'only the events to the caller?',
      undefined,
      {
        context:
          'Real @auth0/auth0-auth-js API surface: new AuthClient({ domain, clientId, clientSecret }) (already in ' +
          'the scaffold, configured from process.env); authClient.exchangeToken({ connection, subjectToken, ' +
          "subjectTokenType: 'urn:ietf:params:oauth:token-type:refresh_token', loginHint?, scope? }) returns a " +
          'TokenResponse { accessToken, expiresAt, scope?, ... } (or { data, response } when fullResponse: true); ' +
          'failures throw TokenExchangeError, exported from @auth0/auth0-auth-js. No audience/resource may be ' +
          'passed to a Token Vault exchange. The deprecated equivalent is getTokenForConnection. Reading ' +
          'config from process.env is correct. Grade from the source code only.',
      },
    ),
  ];
}
