import { ranCommand, ranCommandsInOrder, notRanCommand, judge, GraderLevel } from '@a0/evals-graders';

// A goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into. The agent writes nothing to disk — grading leans entirely
// on event graders (command trace) plus a trace-aware judge.
// Tests SMS phone factor setup (enable + message-types) and email factor setup,
// then enforcement via guardian/policies.
export function defineGraders() {
  return [
    // ── L2: Hallucination — agent must NOT substitute OTP for the requested ──
    // SMS phone factor. notRanCommand checks the command trace.
    notRanCommand(
      'guardian/factors/otp',
      'Did not enable OTP factor instead of SMS',
      GraderLevel.L2,
    ),

    // ── L4: Set phone message type to SMS (not voice) ────────────────────
    ranCommand(
      'guardian/factors/phone/message-types',
      ['sms'],
      'Set phone message type to SMS',
      GraderLevel.L4,
    ),

    // ── L4: Enable the email factor ───────────────────────────────────────
    ranCommand(
      'guardian/factors/email',
      ['enabled'],
      'Enabled email MFA factor',
      GraderLevel.L4,
    ),

    // ── L4: Enforce MFA policy ────────────────────────────────────────────
    ranCommand('guardian/policies', ['all-applications'], 'Enforced MFA via guardian/policies', GraderLevel.L4),

    // ── L4: SMS factor must be enabled BEFORE the enforcement policy ──────
    ranCommandsInOrder(
      ['guardian/factors/sms', 'guardian/policies'],
      'SMS factor enabled before enforcing MFA policy',
      GraderLevel.L4,
    ),

    // ── L4: Email factor must be enabled BEFORE the enforcement policy ────
    ranCommandsInOrder(
      ['guardian/factors/email', 'guardian/policies'],
      'Email factor enabled before enforcing MFA policy',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Based on the command trace, does the solution: ' +
        '(1) enable the SMS phone factor (guardian/factors/sms), set message-types to SMS ' +
        '(guardian/factors/phone/message-types), and configure the phone provider; ' +
        '(2) enable the email factor (guardian/factors/email) — with another factor already enabled first; ' +
        '(3) enforce MFA via guardian/policies with all-applications — ' +
        'using only the Auth0 CLI, not the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
