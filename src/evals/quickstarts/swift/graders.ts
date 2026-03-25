import { contains, notContains, notContainsInSource, matches, judge } from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('Auth0', 'Uses Auth0 SDK'),
    contains('import Auth0', 'Imports Auth0 module'),
    contains('webAuth()', 'Uses webAuth() for login'),
    contains('clearSession', 'Uses clearSession for logout'),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('Auth0SDK', 'No hallucinated Auth0SDK package name (correct package is Auth0)'),
    notContains('pod ', 'Does not use CocoaPods (SPM preferred)'),
    notContains('completionHandler', 'Does not use deprecated completion handler pattern'),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in Swift source files (ok in Auth0.plist)',
    ),
    notContainsInSource('dev-barkbook.us.auth0.com', 'No hardcoded domain in Swift source files (ok in Auth0.plist)'),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    contains('credentialsManager', 'Uses CredentialsManager for token storage'),
    judge(
      'Does the code properly handle login and logout flows with appropriate error handling? ' +
        'Does it update the UI state after successful authentication?',
      'ios',
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    matches(String.raw`webAuth\(\)\.start\(\)`, 'Uses async/await webAuth().start() syntax (not completion handlers)'),
    judge(
      'Does the code use modern Swift async/await patterns with the Auth0.swift SDK? ' +
        'Specifically: does it use try await webAuth().start() and CredentialsManager, ' +
        'and configure via Auth0.plist rather than hardcoded strings?',
      'ios',
    ),

    // ── Holistic judge ───────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a Swift iOS app with ' +
        'webAuth() login/logout, credential management, and proper SwiftUI state handling?',
      'ios',
    ),
  ];
}
