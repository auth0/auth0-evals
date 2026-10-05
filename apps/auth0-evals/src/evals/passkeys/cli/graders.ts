import { ranCommand, ranCommandsInOrder, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L2: Hallucination — passkeys are a connection authentication method, ──
    // NOT the Guardian WebAuthn MFA factors.
    notRanCommand(
      'guardian/factors/webauthn',
      'Did not configure Guardian WebAuthn MFA factors instead of connection passkeys',
      GraderLevel.L2,
    ),

    // ── L2: Hallucination — local_enrollment_enabled was not requested ────
    // Seed resets it to false; only agents that actively enable it (set to true)
    // should fail. Matching the value prevents false positives from read/verify
    // commands that mention the field name without setting it.
    notRanCommand(
      '"local_enrollment_enabled":true',
      'Did not enable local_enrollment_enabled (not requested)',
      GraderLevel.L2,
    ),

    // ── L4: Enable passkeys on the database connection ────────────────────
    // resolveWriteRefs: the patch body is often built with the write tool and
    // applied via `auth0 connections update ... --data @file` (then rm'd), so the
    // payload token lives only in the write-tool call — fold it into the trace.
    ranCommand('connections', ['passkey'], 'Enabled passkeys on the database connection', GraderLevel.L4, {
      resolveWriteRefs: true,
    }),

    // ── L4: Configure progressive enrollment via passkey_options ──────────
    ranCommand(
      'connections',
      ['progressive_enrollment_enabled'],
      'Configured progressive passkey enrollment',
      GraderLevel.L4,
      { resolveWriteRefs: true },
    ),

    // ── L4: Read before write — read the connection before updating it ────
    // The read may be `auth0 api get connections/<id>`, `auth0 api get "connections/<id>"`,
    // or `auth0 connections show`; the write may be `auth0 connections update` or
    // `auth0 api patch connections`.
    ranCommandsInOrder(
      [
        ['get connections', 'get "connections', 'connections show'],
        ['connections update', 'patch connections'],
      ],
      'Read the connection before patching it (merge, not clobber)',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution, based on the command trace: ' +
        '(1) discover the tenant database connection (GET connections) rather than hardcoding an id; ' +
        '(2) enable passkeys on that connection via options.authentication_methods.passkey.enabled = true; ' +
        '(3) configure options.passkey_options with progressive_enrollment_enabled = true; ' +
        "(4) merge the passkey fields into the connection's existing options (reading it first with GET) " +
        'rather than PATCHing a bare options object that would wipe other settings — ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
