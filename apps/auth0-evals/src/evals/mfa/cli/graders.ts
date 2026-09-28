import { ranCommandOneOf, ranCommandsInOrder, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk — grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
// Tests SMS phone factor setup (enable + message-types) and email factor setup,
// then enforcement via guardian/policies.
export function defineGraders() {
  return [
    // ── L2: Hallucination — agent must NOT substitute OTP for the requested ──
    // SMS phone factor. Guard both routes: the `guardian/factors/otp` passthrough
    // and the native `auth0 guardian factors set otp` enable.
    notRanCommand('guardian/factors/otp', 'Did not enable OTP factor instead of SMS (passthrough)', GraderLevel.L2),
    notRanCommand(
      'guardian factors set otp',
      'Did not enable OTP factor instead of SMS (native command)',
      GraderLevel.L2,
    ),
    // The phone factor delivers over SMS or voice; the PROMPT asks for SMS only.
    // `voice` never legitimately appears in this eval's trace, so its presence
    // means the agent enabled the wrong message type on either route.
    notRanCommand('voice', 'Set the phone message type to SMS only, not voice', GraderLevel.L2),

    // Each grader accepts both routes the CLI now offers: the native guardian
    // subcommands (e.g. `auth0 guardian factors phone set-message-types`) and the
    // `auth0 api` Management passthrough (e.g. `guardian/factors/...`). Keying only
    // on the passthrough URL would fail correct work done via the native commands.

    // ── L4: Set phone message type to SMS (not voice) ────────────────────
    ranCommandOneOf(
      ['guardian/factors/phone/message-types', 'guardian factors phone set-message-types'],
      'Set phone message type to SMS',
      GraderLevel.L4,
      ['sms'],
    ),

    // ── L4: Configure the phone/SMS provider ──────────────────────────────
    // PROMPT requires configuring the provider (Auth0's built-in), and the judge
    // checks it, but no event grader did — so it went unverified. Match the
    // provider write on either route.
    ranCommandOneOf(
      [
        'guardian/factors/phone/selected-provider',
        'guardian/factors/sms/selected-provider',
        'guardian factors phone set-provider',
        'guardian factors sms set-provider',
      ],
      'Configured the SMS/phone provider',
      GraderLevel.L4,
    ),

    // ── L4: Enable the email factor ───────────────────────────────────────
    // Native enable is `auth0 guardian factors set email --enabled`.
    ranCommandOneOf(
      ['guardian/factors/email', 'guardian factors set email'],
      'Enabled email MFA factor',
      GraderLevel.L4,
      ['enabled'],
    ),

    // ── L4: Enforce MFA policy ────────────────────────────────────────────
    ranCommandOneOf(
      ['guardian/policies', 'guardian policies set'],
      'Enforced MFA via guardian policies',
      GraderLevel.L4,
      ['all-applications'],
    ),

    // ── L4: SMS factor must be enabled BEFORE the enforcement policy ──────
    ranCommandsInOrder(
      [
        ['guardian/factors/sms', 'guardian factors set sms'],
        ['guardian/policies', 'guardian policies set'],
      ],
      'SMS factor enabled before enforcing MFA policy',
      GraderLevel.L4,
    ),

    // ── L4: Email factor must be enabled BEFORE the enforcement policy ────
    ranCommandsInOrder(
      [
        ['guardian/factors/email', 'guardian factors set email'],
        ['guardian/policies', 'guardian policies set'],
      ],
      'Email factor enabled before enforcing MFA policy',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution: ' +
        '(1) enable the SMS phone factor (guardian/factors/sms), set message-types to SMS ' +
        "(guardian/factors/phone/message-types), and configure the phone provider to use Auth0's built-in provider; " +
        '(2) enable the email factor (guardian/factors/email) — with another factor already enabled first; ' +
        '(3) enforce MFA via guardian/policies with all-applications — ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
