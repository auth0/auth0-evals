import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    contains('auth0_server_python', 'Uses the auth0-server-python SDK', GraderLevel.L1),
    // Relay mode is a client-level flag on ServerClient.
    contains('enterprise_connect', 'Puts the ServerClient into Enterprise Connect relay mode', GraderLevel.L1),
    // The single entry point folds email-domain discovery + the authorize redirect.
    contains(
      'start_enterprise_login',
      'Starts enterprise login via the SDK (domain discovery + authorize redirect in one call)',
      GraderLevel.L1,
    ),
    // The callback that lets the app establish its own session from the claims.
    contains(
      'complete_interactive_login',
      'Completes the login via the SDK so the app can establish its own session',
      GraderLevel.L1,
    ),
    // Logout must terminate the federated IdP session, not just the local app one.
    contains('federated', 'Logout is federated (ends the enterprise IdP session)', GraderLevel.L1),

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

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded Auth0 client secret in source (belongs in the environment)',
      GraderLevel.L3,
    ),
    judge(
      'In the enterprise sign-in path, does the app own the session itself — writing its own session from the ' +
        'ID-token claims returned by complete_interactive_login (the result["user"] claims) — rather than ' +
        'persisting the Auth0 access token for later API calls or relying on an Auth0 session that Enterprise ' +
        'Connect does not create?',
      GraderLevel.L3,
      {
        context:
          'Treat the scaffold pre-existing /transfer access-token route as a fixture: only the new enterprise ' +
          'sign-in path is under test.',
      },
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    // start_enterprise_login is driven by the user-supplied email.
    matches(
      String.raw`start_enterprise_login\s*\([\s\S]{0,200}email`,
      'Calls start_enterprise_login with the user-supplied email',
      GraderLevel.L4,
    ),
    judge(
      'Does the enterprise flow follow the correct shape: (1) the ServerClient is constructed with Enterprise ' +
        'Connect enabled; (2) a login route collects the email and calls start_enterprise_login, redirecting to ' +
        'the returned URL (and falling back when it returns None for a non-federated domain); (3) the callback ' +
        'route completes the login via complete_interactive_login and the app establishes its own session from ' +
        'the returned claims; (4) logout is federated?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current auth0-server-python Enterprise Connect surface ' +
        '(the enterprise_connect option, start_enterprise_login, complete_interactive_login, and a federated ' +
        'LogoutOptions) rather than by hand-building /authorize or /oauth/token requests, calling the raw ' +
        'WebFinger endpoint, decoding the ID token by hand, requesting offline_access / refresh tokens, or ' +
        'pinning a fixed organization for every customer?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect relay login to a Python web app using ' +
        'auth0-server-python — the ServerClient configured for Enterprise Connect, an email-driven ' +
        'start_enterprise_login that routes the user to their enterprise IdP by domain, a callback that lets the ' +
        'app own its own session, and a federated logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of auth0-server-python (since 1.0.0b17). The ' +
          'ServerClient enterprise_connect option, start_enterprise_login (with StartEnterpriseLoginOptions ' +
          'carrying the email) returning a URL or None, complete_interactive_login, is_federated_domain, ' +
          'LogoutOptions.federated, and EnterpriseConnectError are all real — grade the integration, not whether ' +
          'the symbols exist. The SDK is async-only, so awaiting these calls is correct. ' +
          'complete_interactive_login returns a result whose result["user"] is a UserClaims model read by ' +
          'attribute. In relay mode the SDK writes no Auth0 session and issues no refresh token, so the app ' +
          'owning its session and omitting offline_access is correct, not a defect. LogoutOptions.federated ' +
          'defaults to False, so an explicit federated=True is required to end the enterprise IdP session.',
      },
    ),
  ];
}
