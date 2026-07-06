import { matches, notContains, wroteFile, judge, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Correct Guardian resource present in the Terraform config ──────
    // The scaffold ships auth0_client + auth0_resource_server but NO Guardian
    // resource, so a match here is genuinely the agent's work. Regex pins the
    // exact resource type so a hallucinated `auth0_guardian_factor` won't match.
    matches(
      'resource\\s+"auth0_guardian"',
      'Declares an auth0_guardian resource in the Terraform config',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination — invented provider resources ───────────────────
    notContains('auth0_guardian_factor', 'No hallucinated auth0_guardian_factor resource', GraderLevel.L2),
    notContains('auth0_mfa', 'No hallucinated auth0_mfa* resource', GraderLevel.L2),

    // ── L4: Change was authored into a .tf file (event-based) ─────────────
    // Reads the tool-call trace, not file contents — attributes the write to
    // the agent deterministically even though the scaffold ships other .tf.
    wroteFile('.tf', 'Wrote auth0_guardian resource to a Terraform file', GraderLevel.L4, ['auth0_guardian']),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does infra/auth0/main.tf correctly enable an MFA factor on the Auth0 tenant by adding an ' +
        'auth0_guardian resource using the auth0/auth0 Terraform provider — with at least one factor ' +
        '(e.g. otp/push/sms) enabled — and WITHOUT configuring MFA through the dashboard or the Auth0 CLI?',
    ),
  ];
}
