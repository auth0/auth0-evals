import {
  contains,
  notContains,
  notContainsInSource,
  judge,
  ranCommand,
  compiles,
  GraderLevel,
} from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Required SDK patterns present ─────────────────────────────────
    contains('customTokenExchange', 'Uses auth0.customTokenExchange() method', GraderLevel.L1),
    contains(
      'CustomTokenExchangeError',
      'Imports and handles CustomTokenExchangeError',
      GraderLevel.L1,
    ),
    contains(
      '@auth0/nextjs-auth0/errors',
      'Imports error types from the correct path',
      GraderLevel.L1,
    ),
    contains('subjectToken', 'Passes subjectToken param to the exchange call', GraderLevel.L1),
    contains(
      'subjectTokenType',
      'Passes subjectTokenType param to the exchange call',
      GraderLevel.L1,
    ),

    // ── L2: Wrong abstractions absent ─────────────────────────────────────
    notContains(
      'getAccessTokenSilently',
      'Does not use React SPA SDK method (wrong SDK for Next.js server-side)',
      GraderLevel.L2,
    ),
    notContains(
      '@auth0/auth0-react',
      'Does not import the React SPA SDK in a Next.js server app',
      GraderLevel.L2,
    ),
    notContains(
      'urn:ietf:',
      'Does not use the reserved IETF namespace in subjectTokenType',
      GraderLevel.L2,
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'nexuspay_secret_ghi012jkl',
      'No hardcoded client secret in source files (allowed in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'nexuspay_client_abc789def',
      'No hardcoded client ID in source files (allowed in .env)',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness + tenant config ─────────────────────────
    compiles('Project compiles without errors', GraderLevel.L4),
    judge(
      'Is auth0.customTokenExchange() called in a server-side context — a Route Handler, ' +
        'Server Component, or Server Action — and NOT inside a file marked with "use client"?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code catch CustomTokenExchangeError specifically, not just a generic Error? ' +
        'A bare catch(e) without instanceof CustomTokenExchangeError does not count.',
      GraderLevel.L4,
    ),
    ranCommand(
      'auth0',
      ['/api/v2/token-exchange-profiles'],
      'Created a token exchange profile via Auth0 CLI',
      GraderLevel.L4,
    ),

    // ── L5: Consistency (code ↔ config agree) ─────────────────────────────
    judge(
      'Does the subjectTokenType value passed to auth0.customTokenExchange() match the ' +
        'subject_token_type used in the auth0 CLI command that creates the token exchange profile? ' +
        'Both should use the same token type URI — a mismatch causes EXCHANGE_FAILED at runtime.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement Custom Token Exchange using nextjs-auth0 — ' +
        'calling auth0.customTokenExchange() server-side with subjectToken and subjectTokenType, ' +
        'handling CustomTokenExchangeError, and configuring Auth0 with a token exchange profile ' +
        'so the exchange would succeed for real legacy tokens?',
    ),
  ];
}
