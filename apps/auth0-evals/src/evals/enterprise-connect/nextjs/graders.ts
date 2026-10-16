import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

// Barkbook already has its own password sign-in and session; the task puts Enterprise Connect in
// front of it. Judges must not penalise valid placements of the email step or optional extras.
const FIXTURE_CONTEXT =
  'The scaffold is Barkbook, an app with its own email + password sign-in that did not use Auth0 ' +
  'before: GET /signin renders the form (?email= pre-fills it, ?error=invalid shows an error), the POST ' +
  '/api/signin Route Handler verifies the password and signs the user in with the app session helper ' +
  'createSession (lib/session.ts), /dashboard is guarded by the dashboard page getSession() check, and ' +
  '/api/signout clears the app cookie. The SDK was installed but not wired. The task adds Auth0 ' +
  'Enterprise Connect with one Auth0Client, configured with the B2B Connect integration credentials, in ' +
  'front of that existing login. Expected: an email-first step calls startEnterpriseLogin; a federated ' +
  'email goes to Auth0, and a non-federated email falls back to the existing password sign-in at ' +
  '/signin (a redirect to /signin with the email in the query, or rendering the existing sign-in page ' +
  'with the email pre-filled). The quickstart placeholder /login?mode=password must be replaced by that ' +
  'real route. The onCallback hook signs the enterprise user in with the existing createSession helper, ' +
  'mapping the OIDC claims (sub, email, name) onto the app user shape, so the existing /dashboard guard ' +
  'accepts them. The email step may live on /signin itself (email first, then the existing password ' +
  'form) or on a new route, as long as the password sign-in still works. Federated logout must return ' +
  'to /signin, the only registered Allowed Logout URL. Using it only for enterprise users (e.g. ' +
  'recording the sign-in method in the app session) or for every user are both acceptable. Calling ' +
  'isFederatedDomain separately, catching Enterprise Connect errors, and validating org_id are ' +
  'optional. getSession in lib/session.ts is the app own cookie reader, not the SDK auth0.getSession(), ' +
  'so calling it in relay mode is correct. ' +
  'The SDK-mounted /auth/logout route reads federated and returnTo query params and defaults to federated ' +
  'when enterpriseConnect is set, so redirecting there with an absolute /signin returnTo is a correct ' +
  'federated logout.';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    matches(
      String.raw`(?:from\s*|import\s*|require\s*\(\s*)['"]@auth0/nextjs-auth0(?:/[\w.-]+)*['"]`,
      'Uses @auth0/nextjs-auth0 SDK',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    matches(
      String.raw`enterpriseConnect\s*[:=]\s*(true|\{)`,
      'Puts the Auth0Client into Enterprise Connect relay mode (enterpriseConnect option set)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    matches(
      String.raw`\bstartEnterpriseLogin\s*\(|\bstartEnterpriseLogin\b[\s\S]*\bstartEnterpriseLogin\b`,
      'Starts enterprise login via the SDK (server or client helper)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // In relay mode the SDK writes no Auth0 session; onCallback is the only path
    // that can establish the app's own session.
    matches(
      String.raw`\bonCallback\s*[:(=,}]`,
      'Supplies an onCallback hook to establish the app session (no Auth0 session is written in relay mode)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    matches(
      String.raw`federated\s*:\s*true|[?&]federated\b`,
      'Logout is federated (ends the enterprise IdP session)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContainsInSource('@auth0/auth0-spa-js', 'No browser SPA SDK in a Next.js server app', GraderLevel.L2),
    notContainsInSource(
      '/.well-known/webfinger',
      'Does not hand-roll the WebFinger discovery endpoint — the SDK owns domain discovery',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // offline_access / refresh tokens do not exist in relay mode; asking for them
    // is a wrong approach. ignoreComments so an explanatory note is not flagged.
    notContainsInSource(
      'offline_access',
      'Does not request offline_access — Enterprise Connect issues no refresh token',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    notContainsInSource(
      '/oauth/token',
      'Does not hand-roll token exchange — the SDK performs the Enterprise Connect code exchange',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/authorize?',
      'Does not hand-build the /authorize URL — the SDK builds it (login_hint / relay params)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'passport-auth0',
      'Does not fall back to passport-auth0 — it has no Enterprise Connect support',
      GraderLevel.L2,
    ),
    notContainsInSource('auth0-js', 'Does not use the legacy browser auth0-js SDK in a server app', GraderLevel.L2),
    notContainsInSource(
      'jsonwebtoken',
      'Does not hand-decode tokens — the SDK returns validated claims',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'jwt-decode',
      'Does not hand-decode tokens — the SDK returns validated claims',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'organization:',
      'Does not pin a fixed organization — Enterprise Connect routes by the email domain',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'next-auth',
      'Does not use Auth.js/next-auth — Enterprise Connect lives in @auth0/nextjs-auth0',
      GraderLevel.L2,
    ),
    notContainsInSource(
      'auth0.getSession(',
      'auth0.getSession throws in relay mode — use the app own session reader',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'auth0.getAccessToken(',
      'getAccessToken throws in relay mode — no Auth0 session or tokens are kept',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    notContainsInSource(
      'refreshToken',
      'Does not read or store a refresh token — Enterprise Connect issues none',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'refresh_token',
      'Does not use a refresh_token grant or field — Enterprise Connect issues none',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_b2b_secret_def456',
      'No hardcoded Auth0 client secret in source (belongs in the environment)',
      GraderLevel.L3,
    ),
    judge(
      'In the enterprise sign-in path, does the app avoid persisting the Auth0 access token (or any token) from ' +
        'the callback for later use, keeping only identity claims in its own session?',
      GraderLevel.L3,
      { context: FIXTURE_CONTEXT },
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (next build succeeds)', GraderLevel.L4),
    // The enterprise login is driven by the user-supplied email.
    matches(
      String.raw`startEnterpriseLogin\s*\([\s\S]{0,200}email`,
      'Calls startEnterpriseLogin with the user-supplied email',
      GraderLevel.L4,
    ),
    judge(
      'Does the feature wire up the full relay flow? Check each item and answer yes only if all are met: ' +
        '(1) an email-entry login triggers startEnterpriseLogin (server-side returning a NextResponse redirect, or ' +
        'the client helper), routing the user to their IdP by email domain; (2) the onCallback hook builds the app ' +
        'session from the returned claims and returns a NextResponse; (3) logout is federated with an absolute ' +
        'returnTo?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT },
    ),

    // The quickstart fallback is a placeholder the developer must replace with
    // their own login route; Barkbook's existing sign-in lives at /signin.
    notContainsInSource(
      '/login?mode=password',
      'Replaces the quickstart placeholder fallback with the existing /signin route',
      GraderLevel.L4,
      { ignoreComments: true },
    ),
    // /signin is the only registered Allowed Logout URL.
    matches(
      String.raw`returnTo[\s\S]{0,120}/signin`,
      'Federated logout returns to the registered /signin URL',
      GraderLevel.L4,
    ),
    judge(
      'Is the enterprise sign-in integrated with the existing app rather than built beside it? Check each ' +
        'item and answer yes only if all are met: (1) a non-federated email falls back to the existing ' +
        '/signin password sign-in with the email pre-filled, not to a placeholder or a new password flow; (2) ' +
        'the onCallback hook signs the enterprise user in with the existing createSession helper, so the ' +
        'existing /dashboard guard accepts them without a second session mechanism; (3) the existing password ' +
        'sign-in (the POST /api/signin Route Handler and its password check) still works; (4) a single Auth0 ' +
        'client is configured from the B2B Connect integration credentials in the environment; (5) the ' +
        'federated logout returns to /signin?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT },
    ),

    // ── Existing password sign-in still works (non-federated path is untouched) ──
    matches(
      String.raw`export\s+async\s+function\s+POST[\s\S]{0,400}verifyPassword\s*\([\s\S]{0,400}createSession\s*\(`,
      'POST /api/signin still verifies the password and creates the app session',
      GraderLevel.L4,
      { caseSensitive: true },
    ),
    matches(
      String.raw`(?:action|href)\s*=\s*['"]?\{?['"]?/api/signin`,
      'Sign-in form still posts to the existing /api/signin handler',
      GraderLevel.L4,
      { caseSensitive: true },
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/nextjs-auth0 v4 Enterprise Connect surface ' +
        '(the enterpriseConnect option, startEnterpriseLogin from @auth0/nextjs-auth0/server or the client helper ' +
        'from @auth0/nextjs-auth0 or @auth0/nextjs-auth0/client, ' +
        'and the onCallback hook) rather than by hand-building /authorize or token requests, calling getSession in ' +
        'relay mode (which throws), or pinning a fixed organization for every enterprise customer?',
      GraderLevel.L5,
      { context: FIXTURE_CONTEXT },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly put Enterprise Connect relay login in front of the existing sign-in of a Next.js App Router app using ' +
        '@auth0/nextjs-auth0 — the Auth0Client configured for Enterprise Connect with an onCallback hook, an ' +
        'email-driven startEnterpriseLogin that routes users to their enterprise IdP by domain, the app owning its ' +
        'own session created in onCallback, a fallback to the existing /signin password sign-in for non-federated emails, and a federated ' +
        'logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/nextjs-auth0 v4 (4.32.x). ' +
          'Auth0ClientOptions.enterpriseConnect (enterpriseConnect: true on new Auth0Client), the server ' +
          'startEnterpriseLogin — a method on the Auth0Client instance exported from @auth0/nextjs-auth0/server, ' +
          'called as auth0.startEnterpriseLogin({ email, returnTo }) and returning NextResponse | null, the client startEnterpriseLogin (importable from @auth0/nextjs-auth0 or ' +
          '@auth0/nextjs-auth0/client) returning boolean, isFederatedDomain, and the onCallback hook are all real ' +
          '— grade the integration, not whether the symbols exist. The client helper calls the SDK-mounted ' +
          'routes, so no custom route handler is required when it is used. jose is a transitive dependency of the ' +
          'SDK, so importing it without listing it in package.json is acceptable. In relay mode the SDK writes no session and session-dependent methods (getSession, ' +
          'getAccessToken) throw EnterpriseConnectError, so establishing the app session in onCallback and ' +
          'omitting offline_access is correct. A server action cannot return the redirect, so driving ' +
          'startEnterpriseLogin from a Route Handler (and re-emitting the 307 as 303) is the correct shape. ' +
          FIXTURE_CONTEXT,
      },
    ),
  ];
}
