import {
  contains,
  notContains,
  notContainsInSource,
  judge,
  ranCommandOneOf,
  wroteFile,
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
      'meridian_secret_stu678vwx',
      'No hardcoded client secret in source files (allowed in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'meridian_client_mno345pqr',
      'No hardcoded client ID in source files (allowed in .env)',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness + tenant config (any valid method) ──────
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
    ranCommandOneOf(
      ['/api/v2/token-exchange-profiles', 'terraform apply'],
      'Token exchange profile configured via CLI or Terraform',
      GraderLevel.L4,
    ),

    // ── L5: Contextual fit — did the agent use the Terraform workspace? ────
    wroteFile(
      'infra/auth0',
      'Wrote or extended Auth0 Terraform configuration in infra/auth0/',
      GraderLevel.L5,
    ),
    judge(
      'The workspace has an existing Terraform configuration in infra/auth0/. ' +
        'Did the agent extend that Terraform configuration to add auth0_token_exchange_profile ' +
        'rather than using a different tool? Not required, but contextually preferred — ' +
        'note if the agent ignored the existing infrastructure.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement Custom Token Exchange using nextjs-auth0 — ' +
        'calling auth0.customTokenExchange() server-side with subjectToken and subjectTokenType, ' +
        'handling CustomTokenExchangeError, and configuring Auth0 with a token exchange profile ' +
        'so the exchange would succeed for real partner SSO tokens?',
    ),
  ];
}
