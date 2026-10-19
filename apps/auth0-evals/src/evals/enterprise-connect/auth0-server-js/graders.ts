import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

// Barkbook already has its own password sign-in and session; the task puts Enterprise Connect in
// front of it. Judges must not penalise valid placements of the email step or optional extras.
const FIXTURE_CONTEXT =
  'The scaffold is Barkbook, an app with its own email + password sign-in that did not use Auth0 ' +
  'before: GET /signin renders the form (?email= pre-fills it, ?error=invalid shows an error), POST ' +
  '/signin verifies the password and signs the user in with the app session helper createSession, ' +
  '/dashboard is guarded by requireSession, and /signout clears the app cookie. The SDK was installed ' +
  'but not wired. The task adds Auth0 Enterprise Connect with one ServerClient, configured with the B2B ' +
  'Connect integration credentials, in front of that existing login. Expected: an email-first step ' +
  'calls startEnterpriseLogin; a federated email goes to Auth0, and a non-federated email falls back to ' +
  'the existing password sign-in at /signin (a redirect to /signin with the email in the query, or ' +
  'rendering the existing sign-in page with the email pre-filled). The quickstart placeholder ' +
  '/login?mode=password must be replaced by that real route. The /auth/callback route ' +
  '(completeInteractiveLogin) signs the enterprise user in with the existing createSession helper, ' +
  'mapping the OIDC claims (sub, email, name) onto the app user shape, so the existing /dashboard guard ' +
  'accepts them. The email step may live on /signin itself (email first, then the existing password ' +
  'form) or on a new route, as long as the password sign-in still works. Federated logout must return ' +
  'to /signin, the only registered Allowed Logout URL. Using it only for enterprise users (e.g. ' +
  'recording the sign-in method in the app session) or for every user are both acceptable. Calling ' +
  'isFederatedDomain separately, catching Enterprise Connect errors, and validating org_id are ' +
  'optional. ' +
  'Omitting a stateStore is correct (the SDK uses a no-op store in this mode).';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    matches(
      String.raw`(?:from\s*|import\s*|require\s*\(\s*)['"]@auth0/auth0-server-js(?:/[\w.-]+)*['"]`,
      'Uses @auth0/auth0-server-js SDK',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // Relay mode is a client-level flag on ServerClient.
    matches(
      String.raw`enterpriseConnect\s*[:=]\s*(true|\{)`,
      'Puts the ServerClient into Enterprise Connect relay mode (enterpriseConnect option set)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // The single entry point folds email-domain discovery + the authorize redirect.
    matches(
      String.raw`\bstartEnterpriseLogin\s*\(|\bstartEnterpriseLogin\b[\s\S]*\bstartEnterpriseLogin\b`,
      'Starts enterprise login via the SDK (domain discovery + authorize redirect in one call)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // Logout must terminate the federated IdP session, not just the local app one.
    matches(String.raw`federated\s*:\s*true`, 'Logout is federated (ends the enterprise IdP session)', GraderLevel.L1, {
      caseSensitive: true,
    }),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContainsInSource('@auth0/auth0-spa-js', 'No browser SPA SDK in a server-side app', GraderLevel.L2),
    notContainsInSource('@auth0/nextjs-auth0', 'No Next.js SDK in a bare Express app', GraderLevel.L2),
    // isFederatedDomain / WebFinger is the SDK helper; hand-rolling the endpoint
    // means the model bypassed the SDK. ignoreComments so a design note is fine.
    notContainsInSource(
      '/.well-known/webfinger',
      'Does not hand-roll the WebFinger discovery endpoint — the SDK owns domain discovery',
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
    notContainsInSource('.getSession(', 'getSession throws in relay mode — the app owns the session', GraderLevel.L2, {
      ignoreComments: true,
    }),
    notContainsInSource(
      '.getAccessToken(',
      'getAccessToken throws in relay mode — no Auth0 session or tokens are kept',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    notContainsInSource(
      'offline_access',
      'Does not request offline_access — Enterprise Connect issues no refresh token',
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
        'completeInteractiveLogin for later API calls, keeping only identity claims in its own session?',
      GraderLevel.L3,
      { context: FIXTURE_CONTEXT },
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    // startEnterpriseLogin is driven by the user-supplied email.
    matches(
      String.raw`startEnterpriseLogin\s*\([\s\S]{0,200}email`,
      'Calls startEnterpriseLogin with the user-supplied email',
      GraderLevel.L4,
    ),
    // One judge per outcome so a failure names itself. What a regex already checks (startEnterpriseLogin
    // with the email, federated: true, the placeholder, returnTo /signin, the POST /signin password check)
    // is not asked again.
    judge(
      'Does the email step redirect to the URL startEnterpriseLogin returns, and when it returns null ' +
        '(non-federated domain) fall back to the existing /signin password sign-in with the email pre-filled, not ' +
        'to a placeholder or a new password flow?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT },
    ),
    judge(
      'Does the /auth/callback route sign the enterprise user in with the existing createSession helper from ' +
        'the completeInteractiveLogin claims, so the existing /dashboard guard accepts them without a second ' +
        'session mechanism?',
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
      'Is exactly one Auth0 client (ServerClient) configured, from the B2B Connect integration credentials read ' +
        'from the environment?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT },
    ),

    // ── Existing password sign-in still works (non-federated path is untouched) ──
    matches(
      String.raw`\.post\(\s*['"]/signin['"][\s\S]{0,400}verifyPassword\s*\([\s\S]{0,400}createSession\s*\(`,
      'POST /signin still verifies the password and creates the app session',
      GraderLevel.L4,
      { caseSensitive: true },
    ),
    matches(String.raw`\.get\(\s*['"]/signin['"]`, 'GET /signin password form route is still served', GraderLevel.L4, {
      caseSensitive: true,
    }),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-server-js Enterprise Connect surface ' +
        '(the enterpriseConnect option, startEnterpriseLogin, completeInteractiveLogin, and a federated logout) ' +
        'rather than by hand-building /authorize or /oauth/token requests, calling the raw WebFinger endpoint, ' +
        'requesting offline_access / refresh tokens, or pinning a fixed organization for every customer?',
      GraderLevel.L5,
      { context: FIXTURE_CONTEXT },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly put Enterprise Connect relay login in front of the existing sign-in of an Express app using ' +
        '@auth0/auth0-server-js — the client configured for Enterprise Connect, an email-driven ' +
        'startEnterpriseLogin that routes the user to their enterprise IdP by domain, a callback that lets the ' +
        'app own its own session, a fallback to the existing /signin password sign-in for non-federated emails, and a federated ' +
        'logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-server-js (v1.16.x). ' +
          'ServerClientOptions.enterpriseConnect, serverClient.startEnterpriseLogin({ email, returnTo }) returning ' +
          'URL | null, completeInteractiveLogin, isFederatedDomain(auth0Domain, emailDomain), and ' +
          'EnterpriseConnectNotSupportedError are all real exports — grade the integration, not whether the ' +
          'symbols exist. In relay mode the SDK writes no Auth0 session and issues no refresh token, so the app ' +
          'owning its session and omitting offline_access is correct, not a defect. logout defaults federated to ' +
          'true in this mode; an explicit federated: true is also correct. ' +
          FIXTURE_CONTEXT,
      },
    ),
  ];
}
