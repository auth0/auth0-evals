import { ranCommand, ranCommandsInOrder, judge, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L4: Create the Custom Token Exchange validator Action ─────────────
    // Event-based: the whole task is CLI invocations, so there is no artifact
    // to inspect with contains/matches.
    ranCommand('actions', ['custom-token-exchange'], 'Created a custom-token-exchange Action', GraderLevel.L4),
    // ── L4: Deploy the Action (a draft Action is never invoked by Auth0) ───
    ranCommand('actions', ['deploy'], 'Deployed the Action', GraderLevel.L4),
    // ── L4: Create the token exchange profile ─────────────────────────────
    ranCommand('token-exchange-profiles', undefined, 'Created a token exchange profile', GraderLevel.L4),
    // ── L4: Order — the profile references the Action, so the Action must be ─
    // created AND deployed before the profile that points at it. A profile
    // created against a non-existent/undeployed Action silently fails at
    // exchange time, so ordering is part of correctness, not style.
    ranCommandsInOrder(
      ['actions', 'deploy', 'token-exchange-profiles'],
      'Created Action, deployed it, then created the profile — in order',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    // includeCommandTrace: this eval writes no files — the artifact is the CLI
    // trace, so the judge must see the commands the agent ran to evaluate it.
    judge(
      'Based on the command trace, does the solution configure Custom Token Exchange on the Auth0 ' +
        'tenant via the Auth0 CLI — creating a validator Action with the custom-token-exchange trigger, ' +
        'deploying it, and creating a token exchange profile that references that Action — WITHOUT ' +
        'configuring the tenant through the dashboard or Terraform?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
