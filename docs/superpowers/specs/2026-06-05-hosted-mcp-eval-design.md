# Hosted MCP eval — auth + trace-based grading (POC)

**Date:** 2026-06-05
**Branch:** `poc/mcp` (built on top of `feat/event-based-graders`, PR #376)
**Supersedes:** the approach in PR #443 (`feat: add Hosted MCP eval for list-applications`)

## Problem

We want an eval that measures whether an agent correctly uses the Auth0 **hosted MCP server** to perform a read-only task ("list my tenant's applications"). Two gaps block this today:

1. **No auth path for HTTP MCP servers.** `MCPHttpServerConfig` is `{ type, url }` only. The hosted MCP server requires an `Authorization: Bearer` token (a Management API token, `/api/v2/` audience). PR #443 tried to inject this via an ad-hoc `headers` field built from a `getMcpToken()` call in `eval.config.js`, but (a) `headers` is silently dropped by every runner, and (b) the token was minted once at config-load time, so it expires partway through a long matrix run.

2. **The graders measure the wrong corpus.** All existing grader primitives (`contains`, `notContains`, `matches`, `judge`) evaluate against **workspace files**. A "list applications" task produces **no file artifact** — the result is conversational. So PR #443's graders are either impossible to pass (`contains('auth0_list_applications')` — the tool name never lands in a file) or vacuously passing (`notContains('list_clients')` against an empty workspace). None of them observe whether the MCP tool was actually called.

PR #376 (`feat/event-based-graders`) solves half of gap 2: it records the full agent tool-call trace into `record.toolCalls` and adds an `event` grader kind that inspects the trace. But it only ships `ranCommand` / `ranCommandOneOf` / `wroteFile` primitives — there is no primitive to assert that an **MCP tool** was called.

## Goal

A full vertical slice on `poc/mcp`, built on `feat/event-based-graders`:

- Declarative OAuth config for authenticated HTTP MCP servers.
- Per-job token minting (no mid-matrix expiry).
- Header forwarding in the claude-code runner.
- A `calledTool` event-grader primitive.
- A working `hosted_mcp_list_applications` eval graded on the trace, not files.

## Non-goals

- Header forwarding for the **codex** and **copilot** runners (TODO comments only — the eval targets claude-code).
- A hallucinated-MCP-tool-name check (would need a `notCalledTool`-style primitive — out of scope).
- Token caching/refresh across jobs (per-job minting is sufficient and simpler).
- Generalizing beyond the client-credentials grant.

---

## Design

### 1. Auth config on `MCPHttpServerConfig`

`packages/eval-core/src/config/framework.ts`:

```ts
export interface MCPOAuthConfig {
  /** OAuth token endpoint, e.g. https://TENANT/oauth/token */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** API audience, e.g. https://TENANT/api/v2/ */
  audience: string;
}

export interface MCPHttpServerConfig {
  type: 'http';
  url: string;
  auth?: MCPOAuthConfig; // NEW — when present, framework mints a Bearer token per job
}
```

Usage in `eval.config.js`:

```js
...(process.env.MCP_TENANT_DOMAIN ? {
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
} : {}),
```

**Failure handling:** if `auth` is present but any field is empty/undefined (a missing env var), the server is **omitted from the MCP config with a loud `logger.warn`** — never registered unauthenticated. This prevents the #443 failure mode where a misconfigured run looks like "the agent didn't use MCP" instead of "MCP wasn't available."

> Note on audience: the hosted MCP server authenticates with a **Management API** token (`/api/v2/` audience); the `/v1/mcp` audience is reserved by Auth0 and returns `access_denied` for client credentials. This is encoded in the `audience` field above, not hardcoded in the framework.

### 2. Per-job token minting + header forwarding

New helper, `packages/eval-core/src/config/mcp-auth.ts`:

```ts
export async function mintMcpToken(auth: MCPOAuthConfig): Promise<string | undefined> {
  if (!auth.tokenUrl || !auth.clientId || !auth.clientSecret || !auth.audience) return undefined;
  const res = await fetch(auth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      audience: auth.audience,
    }),
  });
  if (!res.ok) return undefined;
  const { access_token } = (await res.json()) as { access_token?: string };
  return access_token;
}
```

Claude-code runner (`packages/eval/src/runners/claude-code/agent.ts`, replacing the loop at ~154-165). The token is minted at **job start** (when MCP config is built), so a `--model all --mode all` matrix gets a fresh token per job:

```ts
let mcpServers:
  | Record<string, { type: 'http'; url: string; headers?: Record<string, string> }>
  | undefined;
if (tools.includes('mcp')) {
  const configServers = getFrameworkConfig().mcp.servers;
  const httpServers: Record<string, { type: 'http'; url: string; headers?: Record<string, string> }> = {};
  for (const [name, server] of Object.entries(configServers)) {
    if (server.type !== 'http') continue;
    if (server.auth) {
      const token = await mintMcpToken(server.auth);
      if (!token) {
        logger.warn(`[ClaudeCode] MCP server '${name}' skipped — token mint failed or creds missing`);
        continue;
      }
      httpServers[name] = { type: 'http', url: server.url, headers: { Authorization: `Bearer ${token}` } };
    } else {
      httpServers[name] = { type: 'http', url: server.url };
    }
  }
  if (Object.keys(httpServers).length > 0) mcpServers = httpServers;
}
```

The Claude Agent SDK's `McpHttpServerConfig` accepts `headers?: Record<string, string>` (verified in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:951-954`), so forwarding works.

**Codex / Copilot runners:** these strip MCP config to `{ type, url }` (codex `agent.ts:62-63`, copilot `agent.ts:57-58`). Out of scope for this POC. Add a `// TODO(poc/mcp): forward MCP auth headers for authenticated HTTP servers` comment at each site so the gap is tracked.

### 3. `calledTool` / `calledToolOneOf` event primitives

`packages/eval-graders/src/primitives.ts`, mirroring the existing event primitives. MCP calls are recorded as `mcp__<server>__<tool>` lowercased (claude-code translator, `mapMcpName` → `.toLowerCase()`), so matching is substring on the lowercased name. Errored calls are excluded (a failed MCP call is not a successful invocation).

```ts
export function calledTool(
  toolName: string,
  description: string | undefined,
  level: EventGraderLevel,
): GraderDef {
  validateEventLevel(level, 'calledTool');
  const lc = toolName.toLowerCase();
  return {
    kind: 'event',
    name: description ?? `called MCP tool '${toolName}'`,
    level,
    predicate: (toolCalls) =>
      toolCalls.some(
        (tc) => tc.name.startsWith('mcp__') && !tc.causedError && tc.name.toLowerCase().includes(lc),
      ),
  };
}

export function calledToolOneOf(
  toolNames: string[],
  description: string | undefined,
  level: EventGraderLevel,
): GraderDef {
  validateEventLevel(level, 'calledToolOneOf');
  const lcs = toolNames.map((t) => t.toLowerCase());
  return {
    kind: 'event',
    name: description ?? `called one of MCP tools [${toolNames.join(', ')}]`,
    level,
    predicate: (toolCalls) =>
      toolCalls.some(
        (tc) =>
          tc.name.startsWith('mcp__') &&
          !tc.causedError &&
          lcs.some((lc) => tc.name.toLowerCase().includes(lc)),
      ),
  };
}
```

Exported from `packages/eval-graders/src/index.ts`. Both require `EventGraderLevel` (L4 or L5), enforced by `validateEventLevel`, same as `ranCommand`/`wroteFile`.

**Behavior across configs:** agent+mcp only. In baseline/non-mcp configs there are no MCP calls, so the predicate returns false and the grader fails — consistent with how event graders fail gracefully without tool calls. The eval's level assignment (L4) reflects this: L4 runs in agent configs; the MCP server is only present under `--tools mcp`.

### 4. The `hosted_mcp_list_applications` eval

`apps/auth0-evals/src/evals/hosted-mcp/list-applications/PROMPT.md`:

```markdown
---
id: hosted_mcp_list_applications
name: Hosted MCP - List Applications
category: hosted-mcp
---

## Task

I need to see all the applications registered in my Auth0 tenant. List them for me.
```

(The hardcoded `Domain: mcptesttenant...` line from #443 is removed — the tenant/domain is supplied through MCP server config, not the prompt.)

`apps/auth0-evals/src/evals/hosted-mcp/list-applications/graders.ts`:

```ts
import { calledTool, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // L4: agent actually invoked the right MCP tool (trace-based)
    calledTool('auth0_list_applications', 'Called the auth0_list_applications MCP tool', GraderLevel.L4),
  ];
}
```

**Known POC deviation:** AGENTS.md convention says every eval ends with a holistic `judge` (no level). This eval intentionally has **no** holistic judge, because the task produces no file artifact and the judge only sees workspace files (`llm-judge.ts:40`) — it would be judging an empty corpus. The meaningful correctness signal is the `calledTool` L4 trace check. This deviation is a conscious POC choice; revisiting it (e.g. by feeding the final agent message or trace into the judge) is a follow-up.

**Graders removed from #443 and why:**

| #443 grader | Verdict |
|---|---|
| `contains('auth0_list_applications', L1)` | Impossible to pass — tool name never appears in a written file. Replaced by `calledTool` at L4. |
| `notContains('list_clients' / 'get_applications' / 'list_apps', L2)` | Vacuously pass against an empty workspace — measure nothing. File-scanning can't catch hallucinated tool names for a no-artifact task. Dropped. |
| `judge('…without unnecessary extra tool calls…', L4)` | Efficiency concern, already covered by the Efficiency scoring dimension. Dropped to keep L4 = correctness. |
| `judge('…retrieve and present…')` holistic | Dropped per POC decision above (thin evidence; empty corpus). |

---

## Testing

- **`mintMcpToken`** (`packages/eval-core/tests/...`): mock `fetch`; cover success (returns token), non-ok response (returns undefined), missing creds (returns undefined without calling fetch).
- **`calledTool` / `calledToolOneOf`** (`packages/eval-graders` or `packages/eval-core/tests/graders/engine.test.ts`, alongside existing event-grader tests): pass when an `mcp__server__tool` call matches; fail when only a non-mcp tool of the same substring is present; fail when the matching call has `causedError: true`; fail when no toolCalls (baseline); invalid level throws. `calledToolOneOf`: passes when any alternative matches.
- **Claude-code runner MCP build**: unit-test the auth branch — server with `auth` and a (mocked) successful token → `headers` set; token mint failure → server omitted + warning. (Match existing runner test patterns; if the runner has no unit-test seam, cover `mintMcpToken` directly and verify the wiring by inspection + smoke test.)
- **Smoke test:** `npm run evals -- --eval hosted_mcp_list_applications --mode agent --tools mcp --model <claude-model> --agent-type claude-code` with `MCP_TENANT_DOMAIN` / `MCP_CLIENT_ID` / `MCP_CLIENT_SECRET` set — confirm the agent calls the tool and the L4 grader passes.

## Docs to update

- **AGENTS.md** — grader-primitives table: add `calledTool` / `calledToolOneOf`. Note the new `auth` field on HTTP MCP servers in the relevant section.
- **docs/ADDING_EVALS.md** — grader-primitives table: add `calledTool` / `calledToolOneOf`; a short note on authenticated HTTP MCP servers.
- This spec records the holistic-judge deviation.

## Risks / open questions

- **No-artifact grading is inherently thin.** The whole eval rests on one L4 trace check. That's correct for "did it call the tool" but says nothing about whether the *presented* output was accurate. Acceptable for a POC; a future trace/last-message-aware judge would strengthen it.
- **Token lifetime vs. a single very long job.** Per-job minting fixes mid-matrix expiry, but a single job that runs longer than the token TTL could still 401 late. Management API tokens are typically long-lived (hours) vs. the 30-min job timeout, so this is not a concern in practice.
- **Other runners.** Until codex/copilot forward headers, this eval only produces meaningful results under `--agent-type claude-code`. The TODO comments make that explicit.
