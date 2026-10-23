import { notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

// Verified surface of auth0-server-python, so judges do not flag real behaviour as hallucinated.
const PY_SURFACE_CONTEXT =
  'In auth0-server-python, Enterprise Connect is enabled by passing enterprise_connect=True to the ' +
  'ServerClient(...) constructor. Only a transaction_store is needed (no state_store), because the SDK writes ' +
  'no Auth0 session in relay mode, so omitting state_store is correct. Internal SDK helpers such as ' +
  '_apply_enterprise_connect_restrictions are real SDK internals and must not be treated as hallucinated. ' +
  'start_interactive_login stays available in this mode (start_enterprise_login builds on it), and every other ' +
  'session-dependent method (get_user, get_session, get_access_token, ...) raises EnterpriseConnectError. ' +
  'The scaffold is a FastAPI app whose CookieTransactionStore reads and writes cookies through store_options, ' +
  'so passing {"request": request, "response": response} on each SDK call is correct.';

// Barkbook already has its own password sign-in and session; the task puts Enterprise Connect in
// front of it. Judges must not penalise valid placements of the email step or optional extras.
const FIXTURE_CONTEXT =
  'The scaffold is Barkbook, an app with its own email + password sign-in that did not use Auth0 ' +
  'before: GET /signin renders the form (?email= pre-fills it, ?error=invalid shows an error), POST ' +
  '/signin verifies the password and signs the user in with the app session helper create_session, ' +
  '/dashboard is guarded by require_session, and /signout clears the app cookie. The SDK was installed ' +
  'but not wired. The task adds Auth0 Enterprise Connect with one ServerClient, configured with the B2B ' +
  'Connect integration credentials, in front of that existing login. Expected: an email-first step ' +
  'calls start_enterprise_login; a federated email goes to Auth0, and a non-federated email falls back ' +
  'to the existing password sign-in at /signin (a redirect to /signin with the email in the query, or ' +
  'rendering the existing sign-in page with the email pre-filled). The quickstart placeholder ' +
  '/login?mode=password must be replaced by that real route. The /auth/callback route ' +
  '(complete_interactive_login) signs the enterprise user in with the existing create_session helper, ' +
  'mapping the OIDC claims (sub, email, name) onto the app user shape, so the existing /dashboard guard ' +
  'accepts them. The email step may live on /signin itself (email first, then the existing password ' +
  'form) or on a new route, as long as the password sign-in still works. Federated logout must return ' +
  'to /signin, the only registered Allowed Logout URL. Using it only for enterprise users (e.g. ' +
  'recording the sign-in method in the app session) or for every user are both acceptable. Calling ' +
  'isFederatedDomain separately, catching Enterprise Connect errors, and validating org_id are ' +
  'optional.';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    matches(String.raw`(?:from|import)\s+auth0_server_python\b`, 'Uses the auth0-server-python SDK', GraderLevel.L1, {
      caseSensitive: true,
    }),
    // Relay mode is a client-level flag on ServerClient.
    matches(
      String.raw`enterprise_connect\s*=\s*True`,
      'Puts the ServerClient into Enterprise Connect relay mode (enterprise_connect=True)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // The single entry point folds email-domain discovery + the authorize redirect.
    matches(
      String.raw`\bstart_enterprise_login\s*\(`,
      'Starts enterprise login via the SDK (domain discovery + authorize redirect in one call)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // The callback that lets the app establish its own session from the claims.
    matches(
      String.raw`\bcomplete_interactive_login\s*\(`,
      'Completes the login via the SDK so the app can establish its own session',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // Logout must terminate the federated IdP session, not just the local app one.
    matches(
      String.raw`federated\s*=\s*True`,
      'Logout is federated (LogoutOptions(federated=True) ends the enterprise IdP session)',
      GraderLevel.L1,
      { caseSensitive: true },
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContainsInSource('@auth0/auth0-spa-js', 'No browser SPA SDK in a server-side Python app', GraderLevel.L2),
    // Hand-decoding the ID token means the model bypassed the SDK, which already
    // validates and returns the claims from complete_interactive_login.
    notContainsInSource(
      'jwt.decode',
      'Does not hand-decode the ID token — the SDK returns validated claims',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // is_federated_domain / WebFinger is the SDK helper; hand-rolling the endpoint
    // means the model bypassed the SDK. ignoreComments so a design note is fine.
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
    notContainsInSource('/authorize?', 'Does not hand-build the /authorize URL — the SDK builds it', GraderLevel.L2, {
      ignoreComments: true,
    }),
    notContainsInSource(
      'authlib',
      'Does not fall back to a generic OAuth library — use auth0-server-python',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'organization=',
      'Does not pin a fixed organization — Enterprise Connect routes by the email domain',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource('.get_session(', 'get_session fails in relay mode — the app owns the session', GraderLevel.L2, {
      ignoreComments: true,
    }),
    notContainsInSource(
      '.get_access_token(',
      'get_access_token fails in relay mode — no Auth0 session or tokens are kept',
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
        'complete_interactive_login for later API calls, keeping only identity claims in its own session?',
      GraderLevel.L3,
      { context: FIXTURE_CONTEXT + ' ' + PY_SURFACE_CONTEXT },
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    // start_enterprise_login is driven by the user-supplied email.
    matches(
      String.raw`start_enterprise_login\s*\([\s\S]{0,200}email`,
      'Calls start_enterprise_login with the user-supplied email',
      GraderLevel.L4,
    ),
    // One judge per outcome so a failure names itself. What a regex already checks (start_enterprise_login
    // with the email, federated=True, the placeholder, return_to /signin, the POST /signin password check)
    // is not asked again.
    judge(
      'Does the email step redirect to the URL start_enterprise_login returns, and when it returns None ' +
        '(non-federated domain) fall back to the existing /signin password sign-in with the email pre-filled, not ' +
        'to a placeholder or a new password flow?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT + ' ' + PY_SURFACE_CONTEXT },
    ),
    judge(
      'Does the /auth/callback route sign the enterprise user in with the existing create_session helper from ' +
        'the complete_interactive_login claims, so the existing /dashboard guard accepts them without a second ' +
        'session mechanism?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT + ' ' + PY_SURFACE_CONTEXT },
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
      String.raw`return_to[\s\S]{0,120}/signin`,
      'Federated logout returns to the registered /signin URL',
      GraderLevel.L4,
    ),
    judge(
      'Is exactly one Auth0 client (ServerClient) configured, from the B2B Connect integration credentials read ' +
        'from the environment?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT + ' ' + PY_SURFACE_CONTEXT },
    ),

    // ── Existing password sign-in still works (non-federated path is untouched) ──
    // Wide, lazy window: the email step may run first inside the same POST /signin handler.
    matches(
      String.raw`@app\.post\(\s*['"]/signin['"]\)[\s\S]{0,1500}?verify_password\s*\([\s\S]{0,600}?create_session\s*\(`,
      'POST /signin still verifies the password and creates the app session',
      GraderLevel.L4,
      { caseSensitive: true },
    ),
    matches(
      String.raw`@app\.get\(\s*['"]/signin['"]`,
      'GET /signin password form route is still served',
      GraderLevel.L4,
      { caseSensitive: true },
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current auth0-server-python Enterprise Connect surface ' +
        '(the enterprise_connect option, start_enterprise_login, complete_interactive_login, and a federated ' +
        'LogoutOptions) rather than by hand-building /authorize or /oauth/token requests, calling the raw ' +
        'WebFinger endpoint, decoding the ID token by hand, requesting offline_access / refresh tokens, or ' +
        'pinning a fixed organization for every customer?',
      GraderLevel.L5,
      { context: FIXTURE_CONTEXT + ' ' + PY_SURFACE_CONTEXT },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly put Enterprise Connect relay login in front of the existing sign-in of a FastAPI app using ' +
        'auth0-server-python — the ServerClient configured for Enterprise Connect, an email-driven ' +
        'start_enterprise_login that routes the user to their enterprise IdP by domain, a callback that lets the ' +
        'app own its own session, a fallback to the existing /signin password sign-in for non-federated emails, and a federated ' +
        'logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of auth0-server-python (since 1.0.0b17). The ' +
          'ServerClient enterprise_connect option, start_enterprise_login (with StartEnterpriseLoginOptions ' +
          'carrying the email) returning a URL or None, complete_interactive_login, is_federated_domain, ' +
          'LogoutOptions.federated, and EnterpriseConnectError are all real — grade the integration, not whether ' +
          'the symbols exist. The SDK is async-only, so awaiting these calls is correct. ' +
          'complete_interactive_login returns a plain dict (keys user, token_set, id_token, domain, app_state) ' +
          'and result["user"] is itself a plain dict of claims (the SDK returns user_claims.dict()), so reading ' +
          'it with user.get("sub") / user["email"] is correct. In relay mode the SDK writes no Auth0 session and issues no refresh token, so the app ' +
          'owning its session and omitting offline_access is correct, not a defect. LogoutOptions.federated ' +
          'defaults to False, so an explicit federated=True is required to end the enterprise IdP session. ' +
          FIXTURE_CONTEXT +
          ' ' +
          PY_SURFACE_CONTEXT,
      },
    ),
  ];
}
