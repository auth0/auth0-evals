# Protected MCP Servers

This guide covers how to wire up a **protected HTTP MCP server** — one that requires an `Authorization: Bearer` token, such as the Auth0 hosted MCP server which authenticates with a Management API token. It explains the credentials you need, the config to add, and how the framework mints and forwards the token to every runner.

---

## When to use this

- You want an agent to use an MCP server that requires an `Authorization: Bearer` token rather than being publicly reachable.
- The credentials come from a Machine-to-Machine (client-credentials) application, and you want a fresh token minted per job rather than a long-lived secret baked into config.

> **Runner support:** token forwarding is implemented for **all runners** — claude-code, copilot, gemini-cli, and codex. claude-code and copilot forward the token as an `Authorization: Bearer` header in their in-memory MCP server config. codex and gemini-cli keep the token off disk by referencing an env var: codex via a `bearer_token_env_var` key in `config.toml`, gemini-cli via a `Bearer ${MCP_BEARER_*}` header in `settings.json` that the CLI expands from the process env at load time. Either way the raw token is injected into the runner's process env, never written to a file.

---

## Prerequisites

You need an Auth0 tenant with a **Machine-to-Machine application** authorized for the **Management API**:

1. In the Auth0 Dashboard, create (or reuse) an M2M application.
2. Authorize it for the **Auth0 Management API** (`https://YOUR_TENANT/api/v2/`) with the scopes the task needs — e.g. `read:clients` to list applications.
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

To wire up **a different** protected HTTP MCP server, add another entry with an `auth` block. The `auth` field is typed as `MCPOAuthConfig`:

| Field          | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `tokenUrl`     | OAuth token endpoint, e.g. `https://TENANT/oauth/token`             |
| `clientId`     | Client ID for the client-credentials grant                          |
| `clientSecret` | Client secret for the client-credentials grant                      |
| `audience`     | API audience the token is minted for, e.g. `https://TENANT/api/v2/` |

Servers **without** an `auth` block (like `auth0-docs`) continue to work unauthenticated.

---

## Step 3 — How the token is minted and forwarded

You don't write any token code — the framework does it per job:

1. When a job starts with `--tools mcp`, the active runner walks the configured MCP servers.
2. For each HTTP server with an `auth` block, it calls `mintMcpToken(auth)` — a **client-credentials** exchange (`grant_type=client_credentials`) against `tokenUrl` for the given `audience`.
3. The resulting token is forwarded to the MCP server. claude-code and copilot set it as an `Authorization: Bearer <token>` header in their in-memory server config. codex and gemini-cli inject the token into the runner's process env under an `MCP_BEARER_<SERVER>` name and reference it indirectly so the secret stays out of on-disk config: codex writes a `bearer_token_env_var` reference into `config.toml` (Codex rejects an inline `bearer_token`), and gemini-cli writes an `Authorization: Bearer ${MCP_BEARER_<SERVER>}` header into `settings.json` that the CLI expands from the env at settings-load time.

The token is minted **per job**, not at config-load time, so a long `--model all --mode all` matrix never reuses an expired token.

**Loud failure:** if the token mint fails (bad creds, network error, missing field), the server is **skipped with a `logger.warn`** rather than registered unauthenticated. This makes a misconfigured run look like "MCP wasn't available" — not a silent "the agent chose not to use MCP." When `--tools mcp` is requested but **every** server ends up unavailable, each runner also logs a `--tools mcp requested but no MCP servers are available` warning, so an all-fail run doesn't read identically to "MCP was never requested."

**Fail fast:** the token request carries a 10s `AbortSignal.timeout`, so a token endpoint that accepts the connection but never responds can't hang job startup until the 30-min task timeout. The failure log includes the token endpoint URL (to distinguish a DNS/TLS/network failure from a misconfigured URL) and preserves the raw response body even for a `200` with a non-JSON payload (e.g. a proxy/gateway HTML error page).

### Where the token lives, per runner

The runners don't handle the minted token identically, and the difference is worth knowing:

| Runner      | How the token is passed                                                                                                                  | On-disk exposure                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| claude-code | In-memory to the Agent SDK server config                                                                                                 | None                                                                               |
| copilot     | In-memory to the Copilot SDK server config                                                                                               | None                                                                               |
| codex       | Env var referenced by `bearer_token_env_var` in `config.toml` (`$CODEX_HOME`, **outside** the workspace)                                 | Token value never written to a file                                                |
| gemini-cli  | Env var referenced by `Bearer ${MCP_BEARER_<SERVER>}` in `<workspace>/.gemini/settings.json`, expanded from the process env at load time | Only the env-var reference is on disk — the token value is never written to a file |

The Gemini CLI only discovers MCP config from a settings file, but it expands environment variables in every settings string at load time (`$VAR`, `${VAR}`, `${VAR:-default}` — its `resolveEnvVarsInObject`/`resolveEnvVarsInString`), headers included. So the runner writes a `Bearer ${MCP_BEARER_<SERVER>}` reference into `settings.json` and injects the minted token into the subprocess env under that name, keeping the raw token off disk — the same indirection codex uses. As a defence-in-depth note, `.gemini` is also excluded from the grading corpus and the workspace is ephemeral (deleted at the end of every run via `cleanupWorkspace` unless `--keep-workspace` is passed).

---

## Sandbox credential passthrough

When evals run in the Docker sandbox (the default), the framework can only mint a token inside the container if the credentials reach it. The three `MCP_*` vars are forwarded via `sandbox.passthroughEnv` in `eval.config.js`:

```js
sandbox: {
  passthroughEnv: ['MCP_TENANT_DOMAIN', 'MCP_CLIENT_ID', 'MCP_CLIENT_SECRET'],
},
```

Only the **names** are listed here; values are resolved from `process.env` at job launch and never stored in config. Vars that aren't currently set on the host are skipped.

---

## Troubleshooting

| Symptom                                                                           | Likely cause                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Log: `MCP server 'auth0-hosted-mcp' skipped — token mint failed or creds missing` | One of `MCP_TENANT_DOMAIN` / `MCP_CLIENT_ID` / `MCP_CLIENT_SECRET` is unset, or the token endpoint rejected the credentials.                |
| `auth0-hosted-mcp` not registered at all (only `auth0-docs`)                      | The env-var gate in `eval.config.js` evaluated false — at least one of the three vars is empty.                                             |
| Token mint returns `access_denied`                                                | `audience` points at `/v1/mcp` instead of `/api/v2/`, or the M2M app isn't authorized for the Management API.                               |
| `401` late in a very long job                                                     | The minted token's TTL expired mid-job. Management API tokens are typically long-lived (hours) vs. the 30-min job timeout, so this is rare. |

---

## Related docs

- [docs/ADDING_EVALS.md](ADDING_EVALS.md) — grader primitives and how evals are structured.
- [AGENTS.md](../AGENTS.md) — framework overview, runner details, and the MCP auth summary.
