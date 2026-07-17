import { contains, notContains, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence ──────────────────────────────────────────
    contains('@auth0/auth0-spa-js', 'Uses @auth0/auth0-spa-js SDK', GraderLevel.L1),
    contains('useDpop', 'Enables useDpop option on Auth0 client', GraderLevel.L1),
    contains('createFetcher', 'Uses createFetcher to get a DPoP-aware fetcher', GraderLevel.L1),
    contains('UseDpopNonceError', 'UseDpopNonceError imported and referenced', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────
    notContains('@auth0/auth0-react', 'No React SDK in vanilla JS app', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in SPA (public client)', GraderLevel.L2),
    notContains('crypto.subtle', 'No manual DPoP key generation — SDK manages the key pair internally', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens manually stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens manually stored in sessionStorage', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────
    compiles('Project compiles with DPoP configuration', GraderLevel.L4),
    matches(String.raw`useDpop\s*:\s*true`, 'useDpop: true set on Auth0 client', GraderLevel.L4),
    matches(String.raw`createFetcher\s*\(`, 'createFetcher called on Auth0 client', GraderLevel.L4),
    judge(
      'Does the code use the fetcher returned by auth0Client.createFetcher() to make the API request? ' +
        'The fetcher (however the variable is named) automatically sends Authorization: DPoP <token> ' +
        'plus a DPoP proof header. A manual fetch using only getTokenSilently() with ' +
        'Authorization: Bearer would lack the DPoP proof and be rejected by the server.',
      GraderLevel.L4,
    ),
    judge(
      'Does the code catch UseDpopNonceError and retry the API request at least once? ' +
        'When a DPoP nonce is rotated by the server the SDK throws UseDpopNonceError; ' +
        'the correct pattern is to catch it and immediately retry the same request — ' +
        'the SDK will have stored the new nonce automatically.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────
    contains(
      'authorizationParams',
      'Uses authorizationParams (current v2 API, not deprecated top-level options)',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution use the SDK-provided DPoP fetcher (auth0Client.createFetcher()) ' +
        'rather than manually constructing DPoP proofs using WebCrypto, jose, or any third-party library?',
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────
    judge(
      'Does the solution correctly add DPoP token binding to the vanilla JavaScript SPA using @auth0/auth0-spa-js, ' +
        'with useDpop: true on the Auth0 client and auth0Client.createFetcher() used to obtain a DPoP-aware fetcher ' +
        'that automatically sends Authorization: DPoP and the DPoP proof header on API calls?',
    ),
  ];
}
