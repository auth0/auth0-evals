# CLI Workflow Evals

A CLI Workflow Eval measures whether an agent can operate the Auth0 CLI through a multi-step tenant workflow. It is scored on the tenant's real state after the run, not on code the agent wrote. These evals are separate from feature evals, which let the agent pick any tool and grade the feature it delivers. For the existing pattern that grades the agent's command trace, see [CLI_CONFIG_EVALS.md](./CLI_CONFIG_EVALS.md).

## Configurations

These evals are meant to run only in two configurations:

| Configuration | CLI flags |
| ------------- | --------- |
| CLI-only | `--mode agent` |
| CLI + Skill | `--mode agent --tools skills` |

The framework does not enforce this, so pick the flags yourself when you run them. The agent reaches the tenant only through the pre-authenticated `auth0` CLI.

## Tenant fixtures

An eval can ship an optional `fixture.ts` next to `PROMPT.md` and `graders.ts`. Its default export is created with `defineFixture` from `@a0/evals-graders`. Every hook is optional and receives a context with `mgmt` (a Management API client), `workspace`, `runId`, and `seeded` (the values `seed` returned).

```typescript
import { defineFixture } from '@a0/evals-graders';

export default defineFixture({
  async seed({ mgmt, runId }) {
    const app = await mgmt.post<{ client_id: string }>('clients', { name: `Legacy Admin ${runId}` });
    return { legacyAdminId: app.client_id };
  },
  async snapshot({ mgmt, seeded }) {
    return { legacyAdmin: await mgmt.get(`clients/${seeded.legacyAdminId}`) };
  },
  async cleanup({ mgmt, seeded }) {
    if (seeded.legacyAdminId) await mgmt.delete(`clients/${seeded.legacyAdminId}`);
  },
});
```

### Lifecycle

1. `seed` runs first, then the pre-run `snapshot`, both before the agent starts.
2. The agent runs.
3. The post-run `snapshot` runs after the agent exits.
4. `cleanup` always runs in a `finally`. Cleanup errors are logged, not thrown. If `seed` or the pre-run snapshot fails, cleanup still runs and the job errors.

Snapshots stay in memory and are never written to the scores file, because a tenant read can include client secrets.

### Rules

- Name run-owned resources with `runId` so parallel runs do not collide.
- Cleanup deletes only what this run created. If `seed` throws partway, `seeded` is empty when cleanup runs, so look run-owned resources up by `runId` too.
- AXIS does not run fixtures and rejects fixture evals. Use `npm run evals`.
- Seed infrastructure, not answers. Do not create the resource the agent is being asked to produce.
- Fixture files are not copied into the agent workspace, so the agent cannot read them.

Fixture evals require `--dangerously-skip-sandbox` (the runner already passes it) and a verifier credential. If either is missing, the job errors with a clear message.

## Verifier credential

The fixture talks to the tenant through a verifier credential that the agent never sees. The agent's environment is an allowlist, so the verifier variables are not passed to it.

- **Local:** set `AUTH0_VERIFIER_DOMAIN`, `AUTH0_VERIFIER_CLIENT_ID`, and `AUTH0_VERIFIER_CLIENT_SECRET` in `apps/auth0-evals/.env`. Use an M2M app with Management API scopes on a dev tenant.
- **CI:** set `AUTH0_VERIFIER_CREDENTIALS_FILE` to a JSON file containing `{ "domain", "client_id", "client_secret" }`. The file is deleted after it is read.

The credential is read once at startup, and every `AUTH0_VERIFIER_*` variable is then removed from the process environment, so setup and compile commands never inherit it. Only an agent job whose eval has a fixture gets its own single-use `0600` credentials file. A partial or invalid verifier config fails only those jobs. The file option exists because on Linux a process running as the same user can read a parent's `/proc/<pid>/environ`.

## Status

Fixtures, the Management API client, and the lifecycle are in place. State graders that consume snapshots and a replay harness for reference and broken solutions follow in later changes.
