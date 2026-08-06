import { ranCommand, ranCommandOneOf, GraderLevel } from '@a0/evals-graders';

/**
 * Graders for the file-less "enable Guardian OTP factor via the auth0 CLI" eval.
 *
 * This eval produces no source artifact — the acceptance signal is which CLI
 * commands the agent ran against the mock Management API. So the graders are
 * event-based (L4), asserting the enable-then-confirm command pair.
 *
 * There is intentionally no holistic `judge`: on the current framework the judge
 * reads workspace files only, and a file-less CLI eval has none. The holistic
 * check is deferred to a future trace-aware judge. (There is also no negative
 * "did-not-run" event primitive today, so hallucinated command groups aren't
 * graded here — the passthrough is enforced positively via the calls below.)
 */
export function defineGraders() {
  return [
    // ── L4: Structural — the right CLI calls were made ────────────────────────
    // Enable OTP via the Management API passthrough: PUT/PATCH guardian/factors/otp.
    ranCommand(
      'auth0 api',
      ['guardian/factors/otp'],
      'Enabled the OTP factor via the Management API passthrough',
      GraderLevel.L4,
    ),
    ranCommandOneOf(
      [
        'put guardian/factors/otp',
        'patch guardian/factors/otp',
        'PUT guardian/factors/otp',
        'PATCH guardian/factors/otp',
      ],
      'Used PUT/PATCH to toggle the OTP factor',
      GraderLevel.L4,
    ),
    // Confirm: read the factor configuration back.
    ranCommand('auth0 api', ['guardian/factors'], 'Read the factor configuration back to confirm', GraderLevel.L4),
  ];
}
