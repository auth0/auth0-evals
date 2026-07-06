import { matches, notContains, wroteFile, judge, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Correct CTE resources present in the Terraform config ─────────
    // The scaffold ships auth0_client + auth0_resource_server but NEITHER a
    // token exchange profile NOR an action, so a match here is genuinely the
    // agent's work. Regexes pin the exact resource types.
    matches(
      'resource\\s+"auth0_token_exchange_profile"',
      'Declares an auth0_token_exchange_profile resource',
      GraderLevel.L1,
    ),
    matches('resource\\s+"auth0_action"', 'Declares an auth0_action resource for the validator', GraderLevel.L1),
    matches(
      'custom-token-exchange',
      'Action uses the custom-token-exchange trigger',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination — invented provider resources ───────────────────
    // The needle keeps the closing quote so it matches the (wrong) bare
    // `auth0_token_exchange` resource type without tripping on the correct
    // `auth0_token_exchange_profile`.
    notContains(
      'auth0_token_exchange"',
      'No hallucinated bare auth0_token_exchange resource (correct type is auth0_token_exchange_profile)',
      GraderLevel.L2,
    ),
    notContains('auth0_custom_token_exchange', 'No hallucinated auth0_custom_token_exchange resource', GraderLevel.L2),

    // ── L4: Change was authored into a .tf file (event-based) ─────────────
    // Reads the tool-call trace, not file contents — attributes the write to
    // the agent deterministically even though the scaffold ships other .tf.
    wroteFile(
      '.tf',
      'Wrote token exchange profile + action to a Terraform file',
      GraderLevel.L4,
      ['auth0_token_exchange_profile', 'auth0_action'],
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does infra/auth0/main.tf correctly configure Custom Token Exchange using the auth0/auth0 ' +
        'Terraform provider — declaring an auth0_action with the custom-token-exchange trigger AND an ' +
        'auth0_token_exchange_profile that references that action (via action_id) with a subject_token_type — ' +
        'WITHOUT configuring the tenant through the dashboard or the Auth0 CLI?',
    ),
  ];
}
