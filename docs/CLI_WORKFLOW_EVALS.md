# CLI Workflow Evals

A CLI Workflow Eval measures whether an agent can operate the Auth0 CLI through a multi-step tenant workflow. It is scored on the tenant's real state after the run, not on code the agent wrote. These evals are separate from feature evals, which let the agent pick any tool and grade the feature it delivers. For the existing pattern that grades the agent's command trace, see [CLI_CONFIG_EVALS.md](./CLI_CONFIG_EVALS.md).

## Configurations

These evals are meant to run only in two configurations:

| Configuration | CLI flags |
| ------------- | --------- |
| CLI-only | `--mode agent` |
| CLI + Skill | `--mode agent --tools skills` |

Pick the tool flags yourself when you run them. Baseline jobs are skipped for any eval with a `fixture.ts`, because baseline never seeds a tenant or runs a CLI. The agent reaches the tenant only through the pre-authenticated `auth0` CLI.

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
3. The post-run `snapshot` runs as soon as the agent exits, before the compile command, so the compile command cannot change the state that gets graded. If it fails, the failure is logged and the run is still graded. The file graders and the judge give their usual result, and `tenantState` graders fail with "Tenant state unavailable".
4. `cleanup` always runs in a `finally`. Cleanup errors are logged, not thrown. If `seed` or the pre-run snapshot fails, cleanup still runs and the job errors.

Snapshots stay in memory during a run. In a two-phase run the agent phase also stores them in the run artefact, masked (see [Two-phase runs with fixtures](#two-phase-runs-with-fixtures)). They are never written to the scores file, because a tenant read can include client secrets.

### Rules

- Name run-owned resources with `runId` so parallel runs do not collide on resources your `seed` creates. This does not isolate tenant-wide settings or anything the agent creates, and the agent is never told `runId`. Every job uses the same verifier tenant, so a pre/post comparison can pick up changes from another job running at the same time. Run fixture evals with `--workers 1` unless the complete fixture and agent workflow is isolated from shared tenant state.
- Management API requests time out after 30 seconds. The client retries HTTP 429 for every method, and network errors, timeouts and 502/503/504 responses for GET, PUT and DELETE only, up to 3 times with backoff. POST and PATCH are not retried on those failures because a lost response after a successful write would duplicate or re-apply it, so a failed `seed` write fails the job.
- `cleanup` runs in a `finally`, so it does not run if the process is hard-killed or interrupted. Name tenant resources with `runId` so leftovers from an aborted run can be found and removed.
- Cleanup deletes only what this run created. If `seed` throws partway, `seeded` is empty when cleanup runs, so look run-owned resources up by `runId` too.
- AXIS does not run fixtures and rejects fixture evals. Use `npm run evals`. Fixture evals also run in the two-phase pipeline (`--phase agent`, then `--phase grade`), as described in [Two-phase runs with fixtures](#two-phase-runs-with-fixtures).
- Seed infrastructure, not answers. Do not create the resource the agent is being asked to produce.
- Fixture files are not copied into the agent workspace, so the agent cannot read them.

Fixture evals require `--dangerously-skip-sandbox` (the runner already passes it) and a verifier credential. If either is missing, the job errors with a clear message.

## Grading tenant state

Two graders read what the fixture captured. `tenantState` runs a predicate over the pre-run and post-run snapshots, and `secretNotExposed` checks that no credential leaked.

```typescript
import { GraderLevel, judge, secretNotExposed, tenantState } from '@a0/evals-graders';

type Snap = { legacyAdmin: unknown; apps: { name: string }[] };

export function defineGraders() {
  return [
    tenantState<Snap>('Created the expected application', GraderLevel.L4, ({ post }) =>
      post.apps.some((a) => a.name.startsWith('Acme')) || 'Expected application not found',
    ),
    tenantState<Snap>('Legacy Admin left untouched', GraderLevel.L4, ({ pre, post }) =>
      JSON.stringify(pre.legacyAdmin) === JSON.stringify(post.legacyAdmin) || 'Legacy Admin was modified',
    ),
    secretNotExposed(),
    judge('Did the agent finish the workflow without unrelated changes?', undefined, { includeCommandTrace: true }),
  ];
}
```

`tenantState(description, level, predicate)` requires L4 or L5. The predicate receives `{ pre, post, seeded }` and returns `true` to pass, `false` to fail, or a string to fail with that reason. The reason is persisted in the scores file, so never put secrets or raw snapshots in it. The snapshots themselves are never written to the scores file. The run artefact keeps a masked copy, so a grade phase can run the same predicates. The grader needs a fixture with a `snapshot` hook, and fails without one. If the predicate throws, the grader fails with a generic message, so an assertion error that quotes snapshot values is never persisted.

`secretNotExposed(description?)` is an L3 check. CLI evals normally move the Security weight to Correctness, but an eval with an L3 grader keeps it, so a leak lowers the score. It always looks for the verifier credential, and also for any value the fixture registers with `ctx.registerSecret(value)` inside its hooks (for example a secret minted on the tenant during `seed`). Registered values must be at least 8 characters, and must not be written into the workspace by the fixture, because they would be there before the agent runs and the grader would always fail. It searches tool call arguments and output, the agent's final reply, and workspace files. The failure detail says where the value was found, never the value itself. It fails when no secret is known, because the check would otherwise pass without testing anything. Every known secret is also masked by exact value in the persisted result and in the recommendations prompt.

The workspace file scan uses the same corpus as other graders, so it skips folders such as `.github`, `.claude`, `.git`, `node_modules` and `dist`, and stops after 200 files. Files the agent writes with a Write or Edit tool are still covered, because the scan also checks tool call arguments.

## Verifier credential

The fixture talks to the tenant through a verifier credential. The agent's environment is an allowlist, so the verifier variables are not passed to it. This keeps the credential out of the agent's environment, but it is not a sandbox. Fixture evals run with `--dangerously-skip-sandbox`, so an agent running on your machine can read files you can read, including `apps/auth0-evals/.env`. In CI the runner uses the same M2M client for the agent's `auth0` CLI login and for the verifier, so the agent can reach that secret through the CLI (for example with `--reveal-secrets`). `secretNotExposed` therefore checks that the agent did not reveal its own credential.

Use a dedicated M2M client for the verifier, on a dev tenant, with only the Management API scopes your fixtures need. Do not reuse a client that has broader access.

- **Local:** set `AUTH0_VERIFIER_DOMAIN`, `AUTH0_VERIFIER_CLIENT_ID`, and `AUTH0_VERIFIER_CLIENT_SECRET` in `apps/auth0-evals/.env`.
- **CI:** set `AUTH0_VERIFIER_CREDENTIALS_FILE` to a JSON file containing `{ "domain", "client_id", "client_secret" }`. The path is consumed: the file is deleted after it is read, so do not point it at a file you want to keep. If the delete fails (for example on a read-only mount), the run logs a warning and continues.

The credential is read once at startup, and every `AUTH0_VERIFIER_*` variable is then removed from the process environment, so setup and compile commands never inherit it. Only an agent job whose eval has a fixture gets its own single-use `0600` credentials file. A partial or invalid verifier config fails only those jobs. The file option exists because on Linux a process running as the same user can read a parent's `/proc/<pid>/environ`.

## Two-phase runs with fixtures

Fixture evals also run in the two-phase pipeline (`--phase agent`, then `--phase grade`). Only the agent phase opens the fixture, so only that job holds the tenant and the verifier credential. It runs the whole lifecycle: seed, pre-run snapshot, the agent, post-run snapshot and cleanup. It loads `fixture.ts` but skips `graders.ts`. The grade phase never opens the fixture and needs no verifier credential.

Before it writes the artefact, the agent phase looks for every known secret (the verifier client secret and any value registered with `ctx.registerSecret`) in tool call arguments and output, the final reply and the workspace files. It records only where a secret appeared, then masks the exact secret values out of the workspace files, the run record and the compile result.

The artefact's `run.json` gets an optional `fixture` block:

- `state`: the masked pre-run and post-run snapshots and the seeded values. `tenantState` predicates run on this in the grade phase. It is missing when the post-run snapshot failed, and `stateError` then says why.
- `exposure`: how many secrets were checked, and the locations where one appeared, such as `tool call 2 output` or `file src/app.ts`. It never holds a value. `secretNotExposed` reads this in the grade phase. With nothing checked, it fails with "No secrets known for this run".

If the post-run snapshot fails, the agent phase still writes the artefact. The `fixture` block then carries `stateError` and no `state`, the file graders and the judge give their usual result, and `tenantState` graders fail with "Tenant state unavailable".

What this means in practice:

- Snapshots are now stored in the artefact. They are masked, but the artefact is still sensitive, so handle it like any other artefact. The scores file still never holds them.
- Content graders in the grade phase read workspace files where known secret values are replaced with `[REDACTED SECRET]`.
- Masking matches exact values only. A transformed secret, such as a base64 copy, is neither masked nor detected, the same as in the combined path.
- Both partial phases need `--dangerously-skip-sandbox`. Only the agent phase needs a verifier credential.
- `--phase all`, `npm run replay` and AXIS work as before.

## Replaying scripted solutions

Graders for a live tenant are easy to get wrong in both directions: a grader that never passes, or one that passes for a broken workflow. `replay` checks them against hand-written solutions before any model runs, with no LLM in the loop.

```bash
npm run replay -- --eval <id>
```

Each eval keeps its scripts in a `replay/` folder next to `fixture.ts`:

```
src/evals/cli-workflows/<eval-dir>/
├── PROMPT.md
├── graders.ts
├── fixture.ts
└── replay/
    ├── reference.sh        # a correct solution
    └── mutants/
        ├── wrong-url.sh    # a broken solution
        └── reveal.sh
```

A script is a list of steps separated by blank lines. Each step runs as its own `bash -c` in a fresh workspace and is recorded as one `run_command` tool call, the same shape as an agent's shell calls, so command graders see a realistic trace. Comment lines are dropped. Steps get `RUN_ID` and every scalar seeded value as `SEED_<KEY>`, so `appId` becomes `SEED_APP_ID`.

```bash
# breaks: Callback set
auth0 apps update "$SEED_APP_ID" --callbacks https://wrong.example.com --no-input --json
```

Every script gets its own seed, snapshot, and cleanup, and the deterministic graders are run on the result. Judges are skipped because they need an LLM. The verdicts work like this:

- The reference must pass every grader.
- A mutant with `# breaks: <grader name>` lines must fail every grader it names. A name that matches no grader is an error.
- A mutant without `# breaks:` lines must fail at least one grader.

The command exits 1 when any script misses its verdict. When a step exits non-zero, its output is printed with known secrets masked, because a failing step usually means a broken script rather than a grader verdict.

Replay steps run the `auth0` CLI from your own environment, so log the CLI in to the same tenant as the verifier credential first. Scripts run one at a time, because they share the tenant.
