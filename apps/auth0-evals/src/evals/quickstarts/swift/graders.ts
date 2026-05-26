import { contains, notContains, notContainsInSource, matches, judge, wroteFile, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('Auth0', 'Uses Auth0 SDK', GraderLevel.L1),
    contains('import Auth0', 'Imports Auth0 module', GraderLevel.L1),
    matches(String.raw`\bAuth0\s*\.\s*webAuth\s*\(\s*\)`, 'Uses webAuth() for login', GraderLevel.L1),
    contains('clearSession', 'Uses clearSession for logout', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('Auth0SDK', 'No hallucinated Auth0SDK package name (correct package is Auth0)', GraderLevel.L2),
    notContains('pod ', 'Does not use CocoaPods (SPM preferred)', GraderLevel.L2),
    notContains('completionHandler', 'Does not use deprecated completion handler pattern', GraderLevel.L2),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in Swift source files (ok in Auth0.plist)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in Swift source files (ok in Auth0.plist)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    wroteFile('Auth0.plist', 'Created Auth0.plist for credentials', GraderLevel.L4),
    contains('credentialsManager', 'Uses CredentialsManager for token storage', GraderLevel.L4),
    judge(
      'Does the code properly handle login and logout flows with appropriate error handling? ' +
        'Does it update the UI state after successful authentication?',
      'ios',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    matches(
      String.raw`webAuth\(\)\.start\(\)`,
      'Uses async/await webAuth().start() syntax (not completion handlers)',
      GraderLevel.L5,
    ),
    judge(
      'Does the code use modern Swift async/await patterns with the Auth0.swift SDK? ' +
        'Specifically: does it use try await webAuth().start() and CredentialsManager, ' +
        'and configure via Auth0.plist rather than hardcoded strings?',
      'ios',
      GraderLevel.L5,
    ),

    // ── Holistic judge ───────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a Swift iOS app with ' +
        'webAuth() login/logout, credential management, and proper SwiftUI state handling?',
      'ios',
    ),
  ];
}
