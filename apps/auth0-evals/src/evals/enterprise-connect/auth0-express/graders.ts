import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

// Barkbook already has its own password sign-in and session; the task puts Enterprise Connect in
// front of it. Judges must not penalise valid placements of the email step or optional extras.
const FIXTURE_CONTEXT =
  'The scaffold is Barkbook, an app with its own email + password sign-in that did not use Auth0 ' +
  'before: GET /signin renders the form (?email= pre-fills it, ?error=invalid shows an error), POST ' +
  '/signin verifies the password and signs the user in with the app session helper createSession, ' +
  '/dashboard is guarded by requireSession, and /signout clears the app cookie. The SDK was installed ' +
  'but not wired. The task adds Auth0 Enterprise Connect with one createAuth0 client, configured with ' +
  'the B2B Connect integration credentials, in front of that existing login. Expected: an email-first ' +
  'step calls startEnterpriseLogin; a federated email goes to Auth0, and a non-federated email falls ' +
  'back to the existing password sign-in at /signin (a redirect to /signin with the email in the query, ' +
  'or rendering the existing sign-in page with the email pre-filled). The quickstart placeholder ' +
  '/login?mode=password must be replaced by that real route. The onCallback hook signs the enterprise ' +
  'user in with the existing createSession helper, mapping the OIDC claims (sub, email, name) onto the ' +
  'app user shape, so the existing /dashboard guard accepts them. The email step may live on /signin ' +
  'itself (email first, then the existing password form) or on a new route, as long as the password ' +
  'sign-in still works. Federated logout must return to /signin, the only registered Allowed Logout ' +
  'URL. Using it only for enterprise users (e.g. recording the sign-in method in the app session) or ' +
  'for every user are both acceptable. Calling isFederatedDomain separately, catching Enterprise ' +
  'Connect errors, and validating org_id are optional. ' +
  'req.auth0.client is the real underlying ServerClient, and a custom logout route that clears the app ' +
  'cookie and redirects to await req.auth0.client.logout({ returnTo, federated: true }) is the ' +
  'SDK-documented logout in EC mode, not an invented API. The startEnterpriseLogin returnTo option is ' +
  'surfaced to onCallback as appState.returnTo.';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    contains('@auth0/auth0-express', 'Uses @auth0/auth0-express SDK', GraderLevel.L1),
    // Relay mode is a client-level flag; it also makes onCallback mandatory.
    matches(
      String.raw`enterpriseConnect\s*[:=]`,
      'Puts the client into Enterprise Connect relay mode (enterpriseConnect option set)',
      GraderLevel.L1,
    ),
    // The single entry point folds email-domain discovery + the authorize redirect.
    contains(
      'startEnterpriseLogin',
      'Starts enterprise login via the SDK (domain discovery + authorize redirect in one call)',
      GraderLevel.L1,
    ),
    // In relay mode the SDK writes no Auth0 session; onCallback is the only path
    // that can establish the app's own session, and config throws without it.
    contains(
      'onCallback',
      'Supplies an onCallback hook to establish the app session (required when enterpriseConnect is set)',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContainsInSource('@auth0/auth0-spa-js', 'No browser SPA SDK in a server-side Express app', GraderLevel.L2),
    notContainsInSource('@auth0/nextjs-auth0', 'No Next.js SDK in a bare Express app', GraderLevel.L2),
    notContainsInSource(
      'express-openid-connect',
      'Does not fall back to the legacy express-openid-connect SDK — EC exists only in @auth0/auth0-express',
      GraderLevel.L2,
    ),
    // requiresAuth()/getUser throw in EC mode; using them to gate the enterprise
    // path is the documented wrong approach.
    notContainsInSource(
      'requiresAuth',
      'Does not guard EC routes with requiresAuth() — it calls getUser(), which throws in relay mode',
      GraderLevel.L2,
    ),
    // isFederatedDomain / WebFinger is the SDK helper; hand-rolling the endpoint
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
    compiles('Project compiles (tsc build succeeds)', GraderLevel.L4),
    // The enterprise login is driven by the user-supplied email.
    matches(
      String.raw`startEnterpriseLogin\s*\([\s\S]{0,200}email`,
      'Calls startEnterpriseLogin with the user-supplied email',
      GraderLevel.L4,
    ),
    judge(
      'Does the enterprise flow follow the correct shape? Check each item and answer yes only if all are met: ' +
        '(1) an email-entry login calls startEnterpriseLogin(req, res, { email }), routing the user to their IdP ' +
        'by email domain and falling back when it returns false for a non-federated domain; (2) the onCallback ' +
        'hook builds the app session from the returned claims and ends the response itself; (3) logout ends the ' +
        'enterprise IdP session with req.auth0.client.logout({ returnTo, federated: true }) — the mounted ' +
        '/auth/logout returns to the base URL, which is not a registered Allowed Logout URL here?',
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
        'sign-in (POST /signin and its password check) still works; (4) a single Auth0 client is configured ' +
        'from the B2B Connect integration credentials in the environment; (5) the federated logout returns to ' +
        '/signin?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT },
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-express Enterprise Connect surface ' +
        '(createAuth0 with the enterpriseConnect option and onCallback hook, startEnterpriseLogin, and a federated ' +
        'logout via either the mounted /auth/logout or req.auth0.client.logout({ federated: true })) rather than by hand-building /authorize or /oauth/token requests, calling the ' +
        'raw WebFinger endpoint, using the legacy express-openid-connect afterCallback hook, gating routes with ' +
        'requiresAuth()/getUser (which throw in relay mode), requesting offline_access, or pinning a fixed ' +
        'organization for every customer?',
      GraderLevel.L5,
      { context: FIXTURE_CONTEXT },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly put Enterprise Connect relay login in front of the existing sign-in of an Express app using ' +
        '@auth0/auth0-express — the client created with enterpriseConnect and an onCallback hook, an email-driven ' +
        'startEnterpriseLogin that routes users to their enterprise IdP by domain, the app owning its own session ' +
        'created in onCallback, a fallback to the existing /signin password sign-in for non-federated emails, and a federated ' +
        'logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-express (1.0.0-beta.4), the ' +
          'successor to express-openid-connect that wraps @auth0/auth0-server-js. The createAuth0 factory, its ' +
          'enterpriseConnect option, the required onCallback hook (EnterpriseConnectCallbackHook), ' +
          'startEnterpriseLogin(req, res, options) returning boolean, isFederatedDomain, and ' +
          'EnterpriseConnectNotSupportedError are all real — grade the integration, not whether the symbols ' +
          'exist. StartEnterpriseLoginOptions is imported from @auth0/auth0-server-js (not re-exported by ' +
          'auth0-express). When enterpriseConnect is set, config throws at startup if onCallback is missing, the ' +
          'SDK writes no Auth0 session (so the onCallback hook must end the response or the handler returns 500 ' +
          'callback_not_resolved), and the mounted /auth/logout is forced federated. getSession, getAccessToken, ' +
          'getUser, and requiresAuth() all throw in relay mode, so the app owning its session and omitting ' +
          'offline_access is correct, not a defect. ' +
          FIXTURE_CONTEXT,
      },
    ),
  ];
}
