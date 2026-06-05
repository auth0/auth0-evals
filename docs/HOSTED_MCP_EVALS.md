# Authenticated Hosted MCP Evals

This guide covers how to wire up an eval that exercises an **authenticated HTTP MCP server** — for example the Auth0 hosted MCP server, which requires a Management API Bearer token. It explains the credentials you need, the config to add, how the framework mints and forwards the token, and how the task is graded.

---

## When to use this

- You want to measure whether an agent correctly uses a hosted MCP server to perform a task (e.g. "list my tenant's applications").
- The MCP server requires an `Authorization: Bearer` token rather than being publicly reachable.
- The task is **conversational** — it produces no file artifact — so it must be graded on the agent's tool-call trace, not on workspace files.

> **Runner support:** token forwarding is implemented for the **claude-code** runner only. The codex and copilot runners drop MCP auth headers today (tracked by `TODO(poc/mcp)` comments). Run authenticated MCP evals with `--agent-type claude-code`.

---

## Prerequisites

You need an Auth0 tenant with a **Machine-to-Machine application** authorized for the **Management API**:

1. In the Auth0 Dashboard, create (or reuse) an M2M application.
2. Authorize it for the **Auth0 Management API** (`https://YOUR_TENANT/api/v2/`) with the scopes the task needs — for the list-applications eval, `read:clients`.
3. Note the application's **Client ID** and **Client Secret**.

> **Audience matters.** The hosted MCP server authenticates with a **Management API** token (`/api/v2/` audience). The `/v1/mcp` audience is reserved by Auth0 and returns `access_denied` for client credentials — so the `audience` field below points at `/api/v2/`, not at the MCP URL.

---

## Step 1 — Set the environment variables

The server entry in `eval.config.js` is gated on three env vars. If any is missing, the server is omitted (see [Troubleshooting](#troubleshooting)).

```bash
export MCP_TENANT_DOMAIN="your-tenant.us.auth0.com"   # no scheme, no trailing slash
export MCP_CLIENT_ID="your-m2m-client-id"
export MCP_CLIENT_SECRET="your-m2m-client-secret"
```

You can also set the LLM `--model` you intend to run; the proxy/model setup is unchanged from any other eval.

---

## Step 2 — Register the MCP server in `eval.config.js`

The Auth0 hosted MCP server is already registered in `apps/auth0-evals/eval.config.js`, gated on the env vars above:

```js
mcp: {
  servers: {
    'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },

    ...(process.env.MCP_TENANT_DOMAIN &&
    process.env.MCP_CLIENT_ID &&
    process.env.MCP_CLIENT_SECRET
      ? {
          'auth0-hosted-mcp': {
            type: 'http',
            url: `https://${process.env.MCP_TENANT_DOMAIN}/v1/mcp`,
            auth: {
              tokenUrl: `https://${process.env.MCP_TENANT_DOMAIN}/oauth/token`,
              clientId: process.env.MCP_CLIENT_ID,
              clientSecret: process.env.MCP_CLIENT_SECRET,
              audience: `https://${process.env.MCP_TENANT_DOMAIN}/api/v2/`,
            },
          },
        }
      : {}),
  },
},
```

To wire up **a different** authenticated HTTP MCP server, add another entry with an `auth` block. The `auth` field is typed as `MCPOAuthConfig`:

| Field | Meaning |
|---|---|
| `tokenUrl` | OAuth token endpoint, e.g. `https://TENANT/oauth/token` |
| `clientId` | Client ID for the client-credentials grant |
| `clientSecret` | Client secret for the client-credentials grant |
| `audience` | API audience the token is minted for, e.g. `https://TENANT/api/v2/` |

Servers **without** an `auth` block (like `auth0-docs`) continue to work unauthenticated.

---

## Step 3 — How the token is minted and forwarded

You don't write any token code — the framework does it per job:

1. When a job starts with `--tools mcp`, the claude-code runner walks the configured MCP servers.
2. For each HTTP server with an `auth` block, it calls `mintMcpToken(auth)` — a **client-credentials** exchange (`grant_type=client_credentials`) against `tokenUrl` for the given `audience`.
3. The resulting token is forwarded to the MCP server as `Authorization: Bearer <token>`.

The token is minted **per job**, not at config-load time, so a long `--model all --mode all` matrix never reuses an expired token.

**Loud failure:** if the token mint fails (bad creds, network error, missing field), the server is **skipped with a `logger.warn`** rather than registered unauthenticated. This makes a misconfigured run look like "MCP wasn't available" — not a silent "the agent chose not to use MCP."

---

## Step 4 — Grade on the tool-call trace

A "list applications" task produces no file, so the file-scanning primitives (`contains`, `judge`, …) can't measure it. Use the **event-based** primitives that inspect the recorded tool-call trace instead:

| Primitive | Asserts |
|---|---|
| `calledTool(toolName, description, level)` | An MCP tool whose name contains `toolName` was invoked successfully |
| `calledToolOneOf(toolNames, description, level)` | At least one of the named MCP tools was invoked successfully |

MCP calls are recorded as `mcp__<server>__<tool>` (lowercased). The primitives match `toolName` as a **case-insensitive substring** against `mcp__`-prefixed calls and **exclude errored calls**. The `level` is required and must be `GraderLevel.L4` or `GraderLevel.L5`.

The `hosted_mcp_list_applications` eval (`apps/auth0-evals/src/evals/hosted-mcp/list-applications/`) is graded on a single trace check:

```ts
import { calledTool, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    calledTool('auth0_list_applications', 'Called the auth0_list_applications MCP tool', GraderLevel.L4),
  ];
}
```

> **No holistic judge here.** Every other eval ends with a level-less `judge`, but this one doesn't: the judge only sees workspace files, and this task writes none — it would be judging an empty corpus. The correctness signal is the `calledTool` L4 trace check. See `docs/superpowers/specs/2026-06-05-hosted-mcp-eval-design.md` for the rationale.

---

## Step 5 — Run it

```bash
npm run evals -- \
  --eval hosted_mcp_list_applications \
  --mode agent \
  --tools mcp \
  --model claude-opus-4-8 \
  --agent-type claude-code \
  --keep-workspace
```

A passing run shows an `mcp__auth0-hosted-mcp__auth0_list_applications` call in the agent's trace and a passing `calledTool` L4 grader.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Log: `MCP server 'auth0-hosted-mcp' skipped — token mint failed or creds missing` | One of `MCP_TENANT_DOMAIN` / `MCP_CLIENT_ID` / `MCP_CLIENT_SECRET` is unset, or the token endpoint rejected the credentials. |
| `auth0-hosted-mcp` not registered at all (only `auth0-docs`) | The env-var gate in `eval.config.js` evaluated false — at least one of the three vars is empty. |
| Token mint returns `access_denied` | `audience` points at `/v1/mcp` instead of `/api/v2/`, or the M2M app isn't authorized for the Management API. |
| `calledTool` grader fails despite the agent "answering" | The agent answered from training data without calling the tool, the MCP call errored, or you ran a runner other than `claude-code` (codex/copilot don't forward the header yet). |
| 401 late in a very long job | The minted token's TTL expired mid-job. Management API tokens are typically long-lived (hours) vs. the 30-min job timeout, so this is rare. |

---

## Related docs

- [docs/ADDING_EVALS.md](ADDING_EVALS.md) — grader primitives and how evals are structured.
- [docs/superpowers/specs/2026-06-05-hosted-mcp-eval-design.md](superpowers/specs/2026-06-05-hosted-mcp-eval-design.md) — the design rationale behind auth config, per-job minting, and trace-based grading.
