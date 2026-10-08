import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    contains('@auth0/auth0-server-js', 'Uses @auth0/auth0-server-js SDK', GraderLevel.L1),
    // Relay mode is a client-level flag on ServerClient.
    contains('enterpriseConnect', 'Puts the ServerClient into Enterprise Connect relay mode', GraderLevel.L1),
    // The single entry point folds email-domain discovery + the authorize redirect.
    contains(
      'startEnterpriseLogin',
      'Starts enterprise login via the SDK (domain discovery + authorize redirect in one call)',
      GraderLevel.L1,
    ),
    // Logout must terminate the federated IdP session, not just the local app one.
    matches(String.raw`federated\s*:\s*true`, 'Logout is federated (ends the enterprise IdP session)', GraderLevel.L1),

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

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded Auth0 client secret in source (belongs in the environment)',
      GraderLevel.L3,
    ),
    judge(
      'In the enterprise sign-in path, does the app own the session itself — writing its own session from the ' +
        'ID-token claims returned by completeInteractiveLogin (or the equivalent SDK callback result) — rather ' +
        'than persisting the Auth0 access token for later API calls or relying on an Auth0 session that ' +
        'Enterprise Connect does not create?',
      GraderLevel.L3,
      {
        context:
          'Treat the scaffold pre-existing /transfers access-token route as a fixture: only the new enterprise ' +
          'sign-in path is under test.',
      },
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    // startEnterpriseLogin is driven by the user-supplied email.
    matches(
      String.raw`startEnterpriseLogin\s*\([\s\S]{0,200}email`,
      'Calls startEnterpriseLogin with the user-supplied email',
      GraderLevel.L4,
    ),
    judge(
      'Does the enterprise flow follow the correct shape: (1) the ServerClient is constructed with Enterprise ' +
        'Connect enabled; (2) a login route collects the email and calls startEnterpriseLogin, redirecting to the ' +
        'returned URL (and falling back when it returns null for a non-federated domain); (3) the callback route ' +
        'completes the login via the SDK and the app establishes its own session from the returned claims; ' +
        '(4) logout is federated?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-server-js Enterprise Connect surface ' +
        '(the enterpriseConnect option, startEnterpriseLogin, completeInteractiveLogin, and a federated logout) ' +
        'rather than by hand-building /authorize or /oauth/token requests, calling the raw WebFinger endpoint, ' +
        'requesting offline_access / refresh tokens, or pinning a fixed organization for every customer?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect relay login to an Express app using ' +
        '@auth0/auth0-server-js — the client configured for Enterprise Connect, an email-driven ' +
        'startEnterpriseLogin that routes the user to their enterprise IdP by domain, a callback that lets the ' +
        'app own its own session, and a federated logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-server-js (v1.16.x). ' +
          'ServerClientOptions.enterpriseConnect, serverClient.startEnterpriseLogin({ email, returnTo }) returning ' +
          'URL | null, completeInteractiveLogin, isFederatedDomain(auth0Domain, emailDomain), and ' +
          'EnterpriseConnectNotSupportedError are all real exports — grade the integration, not whether the ' +
          'symbols exist. In relay mode the SDK writes no Auth0 session and issues no refresh token, so the app ' +
          'owning its session and omitting offline_access is correct, not a defect. logout defaults federated to ' +
          'true in this mode; an explicit federated: true is also correct.',
      },
    ),
  ];
}
