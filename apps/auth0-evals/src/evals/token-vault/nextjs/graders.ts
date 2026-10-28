import { contains, matches, notContains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Token Vault symbols present ────────────────────────────
    // The scaffold has none of these — lib/auth0.ts is a bare `new Auth0Client()`.
    contains(
      'getAccessTokenForConnection',
      'Exchanges the session refresh token via auth0.getAccessTokenForConnection',
      GraderLevel.L1,
    ),
    contains('google-oauth2', 'Targets the google-oauth2 connection', GraderLevel.L1),
    // Connect flow: either the mounted /auth/connect route (enableConnectAccountEndpoint)
    // or the server-side auth0.connectAccount helper.
    matches(
      String.raw`enableConnectAccountEndpoint|connectAccount\(`,
      'Wires the SDK Connected Accounts flow (enableConnectAccountEndpoint or auth0.connectAccount)',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    // The SDK sets the federated grant internally; spelling it means a hand-rolled /oauth/token call.
    notContainsInSource(
      'grant-type:token-exchange:federated-connection-access-token',
      'Does not hand-roll the Token Vault grant against /oauth/token',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // The SDK owns the My Account connect/complete calls (PKCE + state).
    notContainsInSource(
      '/me/v1/connected-accounts',
      'Does not hand-roll the raw My Account connected-accounts endpoints',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // Pre-Token-Vault workaround: reading provider tokens from user identities via Management API.
    notContainsInSource(
      '/api/v2/users',
      'Does not read Google tokens from Management API user identities',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContains('@auth0/auth0-react', 'No React SPA SDK in a server-side Next.js app', GraderLevel.L2, {
      ignoreComments: true,
    }),

    // ── L3: Security ────────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source (ok in .env.local)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source (ok in .env.local)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in source (ok in .env.local)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code keep the Google access token and the Auth0 refresh token on the server — not passing them ' +
        'as props to Client Components, not returning them in JSON from a Route Handler or Server Action, not ' +
        'logging them, and not persisting them by hand in cookies, localStorage, or a database instead of relying ' +
        'on the SDK session — while treating returning the fetched calendar events or non-secret connection ' +
        'metadata (connection name, scopes, connected account id) to the browser as acceptable?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(
      // Either order: an inline options object, or options built in a variable before the call.
      String.raw`getAccessTokenForConnection\([\s\S]{0,200}connection|connection[\s\S]{0,200}getAccessTokenForConnection\(`,
      'Passes the connection option to getAccessTokenForConnection',
      GraderLevel.L4,
    ),
    judge(
      'Does the dashboard offer a "Connect Google Calendar" action wired through the SDK Connected Accounts ' +
        'flow — either a link to /auth/connect with connection=google-oauth2 while the Auth0Client is constructed ' +
        'with enableConnectAccountEndpoint: true, or a server-side route that returns auth0.connectAccount with ' +
        'connection google-oauth2 — rather than a custom-built authorize or connect redirect?',
      GraderLevel.L4,
    ),
    judge(
      'Does server-side code (a Server Component, Server Action, or Route Handler) call ' +
        'auth0.getAccessTokenForConnection with connection google-oauth2, read the Google access token from the ' +
        'returned token property, send it as an Authorization Bearer header to the Google Calendar API, and ' +
        'catch AccessTokenForConnectionError to show a reconnect or re-login option instead of crashing?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    notContains('handleAuth', 'Does not use v3 handleAuth (v4 uses the Auth0Client middleware)', GraderLevel.L5, {
      ignoreComments: true,
    }),
    notContains('/api/auth/', 'Does not use the v3 /api/auth/ route prefix', GraderLevel.L5, {
      ignoreComments: true,
    }),
    judge(
      'Does the solution use the current @auth0/nextjs-auth0 v4 Token Vault API — Auth0Client from ' +
        '@auth0/nextjs-auth0/server with getAccessTokenForConnection and the SDK connect flow, reading the token ' +
        'property of the result and catching AccessTokenForConnectionError — rather than a hand-built /oauth/token ' +
        'exchange, a Management API identities lookup, reading a nonexistent accessToken property, or catching ' +
        'AccessTokenError as the only error class?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Token Vault to the Next.js App Router app — a dashboard action that ' +
        'connects the user’s Google account through the SDK Connected Accounts flow, and server-side code that ' +
        'obtains the Google token with auth0.getAccessTokenForConnection for google-oauth2, uses it to fetch ' +
        'upcoming Google Calendar events, renders those events, handles AccessTokenForConnectionError with a ' +
        'reconnect path, and never sends the Google or refresh token to the browser?',
      undefined,
      {
        context:
          '@auth0/nextjs-auth0 v4 (4.11.0+) exposes these real APIs: the Auth0Client from ' +
          '"@auth0/nextjs-auth0/server" with auth0.getAccessTokenForConnection({ connection, login_hint?, ' +
          'subject_token_type? }) which returns { token, expiresAt, scope? } (the property is token, not ' +
          'accessToken); the error class AccessTokenForConnectionError (exported from "@auth0/nextjs-auth0/errors") ' +
          'with codes missing_session, missing_refresh_token, failed_to_exchange_refresh_token; ' +
          'new Auth0Client({ enableConnectAccountEndpoint: true }) which mounts GET ' +
          '/auth/connect?connection=...&returnTo=...&scopes=...; and auth0.connectAccount({ connection, scopes?, ' +
          'authorizationParams?, returnTo? }) which returns a NextResponse redirect. The default login scope ' +
          'already includes offline_access. DPoP is optional and must not be required. Config read from ' +
          'process.env (AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, etc.) or implicitly by the SDK is ' +
          'correct. Judge only source code; do not penalize how the scaffold-provided .env.local or .gitignore ' +
          'are handled — secret-in-source is covered by other graders.',
      },
    ),
  ];
}
