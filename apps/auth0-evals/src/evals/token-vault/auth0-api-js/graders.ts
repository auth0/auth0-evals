import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Token Vault symbols present ──────────────────────────
    // The scaffold already has ApiClient, verifyAccessToken and the env-sourced
    // domain/audience — only the Token Vault additions are asserted here.
    contains(
      'getAccessTokenForConnection',
      'Exchanges the access token through ApiClient.getAccessTokenForConnection',
      GraderLevel.L1,
    ),
    contains('clientId', 'Configures ApiClient with a clientId (required for the exchange)', GraderLevel.L1),
    contains('clientSecret', 'Configures ApiClient with a clientSecret (required for the exchange)', GraderLevel.L1),
    contains('google-oauth2', 'Requests the token for the google-oauth2 connection', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContainsInSource(
      'grant-type:token-exchange:federated-connection-access-token',
      'Does not hand-roll the Token Vault grant against /oauth/token — the SDK builds it',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'getTokenByExchangeProfile',
      'Does not use Custom Token Exchange (getTokenByExchangeProfile) — a different feature',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'getTokenForConnection',
      'Does not call the deprecated auth-js getTokenForConnection directly',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/api/v2/users',
      'Does not read Google tokens from Management API user identities',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // ApiClient.getAccessTokenForConnection only accepts an access token as the subject.
    notContainsInSource(
      'refreshToken',
      'Does not pass a refresh token — the API-side exchange takes the incoming access token only',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
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
      'Does the /api/calendar route verify the incoming Auth0 access token with apiClient.verifyAccessToken ' +
        'before using it as the subject of the Token Vault exchange, and does it keep the Google access ' +
        'token on the server — never returning it in a response body or header, never logging it, and ' +
        'never persisting it by hand in a database, file, or module-level cache? Returning the Google ' +
        'Calendar event results, the connection name, or the granted scopes to the caller is not a ' +
        'violation, and reading credentials from process.env is correct.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (tsc succeeds)', GraderLevel.L4),
    matches(
      // Either order: an inline options object, or options built in a variable before the call.
      String.raw`getAccessTokenForConnection\([\s\S]{0,200}connection|connection[\s\S]{0,200}getAccessTokenForConnection\(`,
      'Passes an options object carrying the connection to getAccessTokenForConnection',
      GraderLevel.L4,
    ),
    judge(
      'Is the ApiClient that performs the exchange constructed with domain, audience, clientId and ' +
        'clientSecret, with the client id and secret read from environment variables such as ' +
        'process.env.AUTH0_CLIENT_ID and process.env.AUTH0_CLIENT_SECRET rather than hardcoded?',
      GraderLevel.L4,
    ),
    judge(
      'Does the route pass the raw verified access token (without the "Bearer " prefix) as accessToken ' +
        'together with connection "google-oauth2" to getAccessTokenForConnection, then read accessToken ' +
        'from the returned token set and send it as an Authorization Bearer header on a server-side ' +
        'request to the Google Calendar API events endpoint for the primary calendar?',
      GraderLevel.L4,
    ),
    judge(
      'Does the route handle failures distinctly — a missing or invalid Auth0 token yields 401, and a ' +
        'failed Token Vault exchange or Google API error is caught and answered with an appropriate 4xx ' +
        'or 5xx status — without echoing any token value in the error response?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the code obtain the Google token through the @auth0/auth0-api-js ApiClient method ' +
        'getAccessTokenForConnection, rather than through Custom Token Exchange ' +
        '(getTokenByExchangeProfile), a separately constructed @auth0/auth0-auth-js AuthClient with its ' +
        'deprecated getTokenForConnection, or a hand-written POST to the Auth0 /oauth/token endpoint?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution add a GET /api/calendar route to the Express API that verifies the caller’s ' +
        'Auth0 access token, exchanges it via Token Vault for the user’s Google access token using ' +
        '@auth0/auth0-api-js, calls the Google Calendar API server-side, and returns the upcoming events ' +
        'without exposing the Google token, with all Auth0 credentials sourced from the environment?',
      undefined,
      {
        context:
          'The scaffold uses @auth0/auth0-api-js 1.6.x. Real API surface: new ApiClient({ domain, audience, ' +
          'clientId, clientSecret }); apiClient.verifyAccessToken({ accessToken }) returns the token claims; ' +
          'apiClient.getAccessTokenForConnection({ connection, accessToken, loginHint? }) returns a ' +
          'ConnectionTokenSet { accessToken, scope, expiresAt, connection, loginHint? } where accessToken is ' +
          'the Google token. It accepts only an Auth0 access token as the subject (no refresh token option) ' +
          'and does not verify that token itself, so verifyAccessToken must run first. Without clientId and ' +
          'clientSecret it throws TokenForConnectionError ("Client credentials are required…"); that class ' +
          'lives in @auth0/auth0-auth-js (a dependency of auth0-api-js, not re-exported by it), so catching ' +
          'errors generically or importing TokenForConnectionError from @auth0/auth0-auth-js are both fine. ' +
          'These are all real, current symbols — do not treat them as hallucinated. Reading configuration ' +
          'from process.env (including via dotenv) is correct. The Google Calendar events endpoint is ' +
          'https://www.googleapis.com/calendar/v3/calendars/primary/events; calling it with fetch or the ' +
          'googleapis client are both acceptable.',
      },
    ),
  ];
}
