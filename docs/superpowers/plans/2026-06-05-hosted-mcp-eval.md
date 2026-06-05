# Hosted MCP Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated HTTP MCP server support with per-job token minting, a `calledTool` event-grader primitive, and a trace-graded `hosted_mcp_list_applications` eval.

**Architecture:** Extend `MCPHttpServerConfig` with an optional `auth` block; the framework mints a Management API token per agent job and forwards it as an `Authorization: Bearer` header in the claude-code runner. A new `calledTool` event primitive (building on PR #376's event-grader infra) asserts an MCP tool was invoked in the recorded tool-call trace. The eval is graded solely on this trace check (no file artifact, no holistic judge).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, `@anthropic-ai/claude-agent-sdk`, monorepo packages `eval-core` / `eval-graders` / `eval`.

**Base branch:** `poc/mcp` (off `feat/event-based-graders`). Spec: `docs/superpowers/specs/2026-06-05-hosted-mcp-eval-design.md`.

---

## File Structure

**Create:**
- `packages/eval-core/src/config/mcp-auth.ts` — `mintMcpToken()` helper (OAuth client-credentials exchange).
- `packages/eval-core/tests/config/mcp-auth.test.ts` — unit tests for `mintMcpToken`.
- `apps/auth0-evals/src/evals/hosted-mcp/list-applications/PROMPT.md` — eval task.
- `apps/auth0-evals/src/evals/hosted-mcp/list-applications/graders.ts` — eval graders.

**Modify:**
- `packages/eval-core/src/config/framework.ts` — add `MCPOAuthConfig`, `auth?` on `MCPHttpServerConfig`.
- `packages/eval-core/src/index.ts` — export `MCPOAuthConfig` type and `mintMcpToken`.
- `packages/eval-graders/src/primitives.ts` — add `calledTool`, `calledToolOneOf`.
- `packages/eval-graders/src/index.ts` — export the two new primitives.
- `packages/eval-graders/tests/primitives.test.ts` — tests for the two new primitives.
- `packages/eval-core/tests/graders/engine.test.ts` — execution tests for `calledTool` via `runGraders`.
- `packages/eval/src/runners/claude-code/agent.ts` — mint token + forward header in MCP config build.
- `packages/eval/src/runners/codex/agent.ts` — TODO comment only.
- `packages/eval/src/runners/copilot/agent.ts` — TODO comment only.
- `apps/auth0-evals/eval.config.js` — register `auth0-hosted-mcp` with `auth` block.
- `AGENTS.md`, `docs/ADDING_EVALS.md` — grader-primitive tables + auth note.

---

## Task 1: `MCPOAuthConfig` type + `auth` field

**Files:**
- Modify: `packages/eval-core/src/config/framework.ts:40-45`
- Modify: `packages/eval-core/src/index.ts:58-72`

- [ ] **Step 1: Add the `MCPOAuthConfig` interface and `auth` field**

In `packages/eval-core/src/config/framework.ts`, replace the existing `MCPHttpServerConfig` block (lines 40-45):

```ts
export interface MCPOAuthConfig {
  /** OAuth token endpoint, e.g. https://TENANT/oauth/token */
  tokenUrl: string;
  /** OAuth client ID for the client-credentials grant. */
  clientId: string;
  /** OAuth client secret for the client-credentials grant. */
  clientSecret: string;
  /** API audience the token is requested for, e.g. https://TENANT/api/v2/ */
  audience: string;
}

export interface MCPHttpServerConfig {
  /** URL-based MCP server. */
  type: 'http';
  /** HTTP URL for the remote MCP server. */
  url: string;
  /**
   * Optional OAuth config. When present, the framework mints a fresh Bearer
   * token per agent job and injects it as an Authorization header. If any
   * field is empty (e.g. a missing env var), the server is omitted with a warning.
   */
  auth?: MCPOAuthConfig;
}
```

- [ ] **Step 2: Export the new type**

In `packages/eval-core/src/index.ts`, add `MCPOAuthConfig` to the framework-config type export block (after `MCPHttpServerConfig,` on line 64):

```ts
  MCPHttpServerConfig,
  MCPOAuthConfig,
```

- [ ] **Step 3: Build to verify types compile**

Run: `npm run build`
Expected: PASS (no TypeScript errors).

- [ ] **Step 4: Commit**

```bash
git add packages/eval-core/src/config/framework.ts packages/eval-core/src/index.ts
git commit -m "feat(config): add optional OAuth auth block to MCPHttpServerConfig"
```

---

## Task 2: `mintMcpToken` helper (TDD)

**Files:**
- Create: `packages/eval-core/src/config/mcp-auth.ts`
- Test: `packages/eval-core/tests/config/mcp-auth.test.ts`
- Modify: `packages/eval-core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/eval-core/tests/config/mcp-auth.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mintMcpToken } from '../../src/config/mcp-auth.js';
import type { MCPOAuthConfig } from '../../src/config/framework.js';

const validAuth: MCPOAuthConfig = {
  tokenUrl: 'https://tenant.us.auth0.com/oauth/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  audience: 'https://tenant.us.auth0.com/api/v2/',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mintMcpToken', () => {
  it('returns the access_token on a successful exchange', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await mintMcpToken(validAuth);

    expect(token).toBe('tok-123');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(validAuth.tokenUrl);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      grant_type: 'client_credentials',
      client_id: 'client-id',
      client_secret: 'client-secret',
      audience: validAuth.audience,
    });
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await mintMcpToken(validAuth)).toBeUndefined();
  });

  it('returns undefined without calling fetch when a credential is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const token = await mintMcpToken({ ...validAuth, clientSecret: '' });
    expect(token).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined when the body has no access_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await mintMcpToken(validAuth)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/eval-core/tests/config/mcp-auth.test.ts`
Expected: FAIL — cannot find module `../../src/config/mcp-auth.js`.

- [ ] **Step 3: Implement `mintMcpToken`**

Create `packages/eval-core/src/config/mcp-auth.ts`:

```ts
/**
 * OAuth token minting for authenticated HTTP MCP servers.
 *
 * Performs a client-credentials exchange to obtain a short-lived Bearer token.
 * Called once per agent job so a long matrix run never reuses an expired token.
 */

import type { MCPOAuthConfig } from './framework.js';
import { logger } from '../utils/logger.js';

export async function mintMcpToken(auth: MCPOAuthConfig): Promise<string | undefined> {
  if (!auth.tokenUrl || !auth.clientId || !auth.clientSecret || !auth.audience) {
    logger.warn('[mcp-auth] Incomplete OAuth config — skipping token mint');
    return undefined;
  }
  try {
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
    if (!res.ok) {
      logger.warn(`[mcp-auth] Token request failed: ${res.status}`);
      return undefined;
    }
    const { access_token } = (await res.json()) as { access_token?: string };
    if (!access_token) {
      logger.warn('[mcp-auth] Token response missing access_token');
      return undefined;
    }
    return access_token;
  } catch (err) {
    logger.warn(`[mcp-auth] Token request error: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
```

- [ ] **Step 4: Export `mintMcpToken`**

In `packages/eval-core/src/index.ts`, after the `defineConfig, loadConfig, deepMerge` export (line 74), add:

```ts
export { mintMcpToken } from './config/mcp-auth.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/eval-core/tests/config/mcp-auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/eval-core/src/config/mcp-auth.ts packages/eval-core/tests/config/mcp-auth.test.ts packages/eval-core/src/index.ts
git commit -m "feat(config): add mintMcpToken client-credentials helper"
```

---

## Task 3: `calledTool` / `calledToolOneOf` primitives (TDD)

**Files:**
- Modify: `packages/eval-graders/src/primitives.ts` (end of file)
- Modify: `packages/eval-graders/src/index.ts`
- Test: `packages/eval-graders/tests/primitives.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/eval-graders/tests/primitives.test.ts`. First ensure the import line at the top includes the new primitives and `EventToolCall`:

```ts
import { contains, notContains, notContainsInSource, matches, judge, calledTool, calledToolOneOf } from '../src/primitives.js';
import { GraderLevel, type EventToolCall } from '../src/types.js';
```

Then append these test blocks:

```ts
// ── calledTool ──────────────────────────────────────────────────────────────

const mcpCalls: EventToolCall[] = [
  { name: 'mcp__auth0-hosted-mcp__auth0_list_applications', args: {}, result: 'ok', causedError: false },
  { name: 'read_file', args: { path: 'x' }, result: 'ok', causedError: false },
];

describe('calledTool', () => {
  it('creates an event GraderDef requiring L4/L5', () => {
    const def = calledTool('auth0_list_applications', undefined, GraderLevel.L4);
    expect(def.kind).toBe('event');
    expect(def.level).toBe(GraderLevel.L4);
    expect(typeof def.predicate).toBe('function');
  });

  it('throws when given a non-event level', () => {
    expect(() => calledTool('x', undefined, GraderLevel.L1 as never)).toThrow(
      /event-based graders only support L4.*or L5/,
    );
  });

  it('predicate passes when a matching mcp__ tool was called', () => {
    const def = calledTool('auth0_list_applications', undefined, GraderLevel.L4);
    expect(def.predicate!(mcpCalls)).toBe(true);
  });

  it('predicate is case-insensitive on the tool name', () => {
    const def = calledTool('AUTH0_LIST_APPLICATIONS', undefined, GraderLevel.L4);
    expect(def.predicate!(mcpCalls)).toBe(true);
  });

  it('predicate fails when only a non-mcp tool matches the substring', () => {
    const calls: EventToolCall[] = [
      { name: 'read_file', args: { path: 'auth0_list_applications.txt' }, result: 'ok', causedError: false },
    ];
    const def = calledTool('auth0_list_applications', undefined, GraderLevel.L4);
    expect(def.predicate!(calls)).toBe(false);
  });

  it('predicate fails when the matching mcp call errored', () => {
    const calls: EventToolCall[] = [
      { name: 'mcp__auth0-hosted-mcp__auth0_list_applications', args: {}, result: 'err', causedError: true },
    ];
    const def = calledTool('auth0_list_applications', undefined, GraderLevel.L4);
    expect(def.predicate!(calls)).toBe(false);
  });

  it('predicate fails on empty trace', () => {
    const def = calledTool('auth0_list_applications', undefined, GraderLevel.L4);
    expect(def.predicate!([])).toBe(false);
  });
});

describe('calledToolOneOf', () => {
  it('passes when any alternative matches', () => {
    const def = calledToolOneOf(['auth0_get_application', 'auth0_list_applications'], undefined, GraderLevel.L4);
    expect(def.predicate!(mcpCalls)).toBe(true);
  });

  it('fails when none match', () => {
    const def = calledToolOneOf(['auth0_create_application'], undefined, GraderLevel.L4);
    expect(def.predicate!(mcpCalls)).toBe(false);
  });

  it('throws when given a non-event level', () => {
    expect(() => calledToolOneOf(['x'], undefined, GraderLevel.L2 as never)).toThrow(
      /event-based graders only support L4.*or L5/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/eval-graders/tests/primitives.test.ts`
Expected: FAIL — `calledTool`/`calledToolOneOf` are not exported from `../src/primitives.js`.

- [ ] **Step 3: Implement the primitives**

Append to `packages/eval-graders/src/primitives.ts` (after the `wroteFile` function added by PR #376):

```ts
// Tool names from any runner that represent MCP tool invocations are prefixed `mcp__`.
const MCP_TOOL_PREFIX = 'mcp__';

/**
 * Asserts that the agent invoked an MCP tool whose (lowercased) name contains
 * the given substring. MCP calls are recorded as `mcp__<server>__<tool>`.
 * Errored calls are excluded — a failed MCP call is not a successful invocation.
 */
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
    predicate: (toolCalls: EventToolCall[]) =>
      toolCalls.some(
        (tc) => tc.name.startsWith(MCP_TOOL_PREFIX) && !tc.causedError && tc.name.toLowerCase().includes(lc),
      ),
  };
}

/**
 * Asserts that the agent invoked at least one of the given MCP tools.
 * Each name is matched as a (lowercased) substring against `mcp__` tool calls.
 */
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
    predicate: (toolCalls: EventToolCall[]) =>
      toolCalls.some(
        (tc) =>
          tc.name.startsWith(MCP_TOOL_PREFIX) &&
          !tc.causedError &&
          lcs.some((lc) => tc.name.toLowerCase().includes(lc)),
      ),
  };
}
```

- [ ] **Step 4: Export the primitives**

In `packages/eval-graders/src/index.ts`, add `calledTool` and `calledToolOneOf` to the grader factory export block (alongside `ranCommand, ranCommandOneOf, wroteFile`):

```ts
export {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  ranCommand,
  ranCommandOneOf,
  wroteFile,
  calledTool,
  calledToolOneOf,
} from './primitives.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/eval-graders/tests/primitives.test.ts`
Expected: PASS (all blocks, including the new `calledTool`/`calledToolOneOf` describes).

- [ ] **Step 6: Commit**

```bash
git add packages/eval-graders/src/primitives.ts packages/eval-graders/src/index.ts packages/eval-graders/tests/primitives.test.ts
git commit -m "feat(graders): add calledTool and calledToolOneOf event primitives"
```

---

## Task 4: `calledTool` execution test via `runGraders`

**Files:**
- Test: `packages/eval-core/tests/graders/engine.test.ts` (append to the event-grader describe block added by PR #376)

- [ ] **Step 1: Write the failing test**

In `packages/eval-core/tests/graders/engine.test.ts`, add `calledTool` to the `@a0/eval-graders` import list (the block that imports `ranCommand, ranCommandOneOf, wroteFile`). Then append inside the existing `describe('runGraders - event graders', ...)` block (before its closing `});`):

```ts
  it('calledTool passes when a matching mcp__ tool was called', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'x.ts'), '');
    const toolCalls: EventToolCall[] = [
      { name: 'mcp__auth0-hosted-mcp__auth0_list_applications', args: {}, result: 'ok', causedError: false },
    ];
    const graders = [calledTool('auth0_list_applications', 'called list apps', GraderLevel.L4)];
    const results = await runGraders(graders, dir, 'unused', undefined, undefined, true, toolCalls);
    expect(results[0]!.passed).toBe(true);
  });

  it('calledTool fails when the tool was not called', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'x.ts'), '');
    const graders = [calledTool('auth0_list_applications', 'called list apps', GraderLevel.L4)];
    const results = await runGraders(graders, dir, 'unused', undefined, undefined, true, sampleToolCalls);
    expect(results[0]!.passed).toBe(false);
  });

  it('calledTool fails gracefully when no toolCalls provided (baseline)', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'x.ts'), '');
    const graders = [calledTool('auth0_list_applications', 'called list apps', GraderLevel.L4)];
    const results = await runGraders(graders, dir, 'unused');
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.detail).toContain('No tool calls available');
  });
```

> Note: `sampleToolCalls`, `tmpDir`, and the `EventToolCall` import already exist in this file from PR #376; only add `calledTool` to the import.

- [ ] **Step 2: Run the new tests to verify they pass**

Run: `npx vitest run packages/eval-core/tests/graders/engine.test.ts -t "calledTool"`
Expected: PASS (3 tests). (The primitive and event executor already exist, so these should pass immediately — they confirm end-to-end wiring through `runGraders`.)

- [ ] **Step 3: Commit**

```bash
git add packages/eval-core/tests/graders/engine.test.ts
git commit -m "test(graders): cover calledTool execution through runGraders"
```

---

## Task 5: Forward auth header in the claude-code runner

**Files:**
- Modify: `packages/eval/src/runners/claude-code/agent.ts:154-165`

- [ ] **Step 1: Add the import**

At the top of `packages/eval/src/runners/claude-code/agent.ts`, add `mintMcpToken` to the existing `@a0/eval-core` import (the one that imports `getFrameworkConfig`). If imported from a different specifier, add:

```ts
import { mintMcpToken } from '@a0/eval-core';
```

- [ ] **Step 2: Replace the MCP config build block**

Replace lines 154-165 (the `// Build MCP server config when --tools mcp is requested.` block) with:

```ts
  // Build MCP server config when --tools mcp is requested.
  // Token is minted here (job start) so a long matrix run never reuses an expired token.
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
        httpServers[name] = {
          type: 'http' as const,
          url: server.url,
          headers: { Authorization: `Bearer ${token}` },
        };
      } else {
        httpServers[name] = { type: 'http' as const, url: server.url };
      }
    }
    if (Object.keys(httpServers).length > 0) mcpServers = httpServers;
  }
```

- [ ] **Step 3: Build to verify types compile**

Run: `npm run build`
Expected: PASS. The SDK's `McpHttpServerConfig` accepts `headers?: Record<string, string>` (sdk.d.ts:951-954), so `mcpServers` remains assignable to the `query()` options.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/runners/claude-code/agent.ts
git commit -m "feat(claude-code): mint and forward MCP auth header per job"
```

---

## Task 6: TODO comments in codex / copilot runners

**Files:**
- Modify: `packages/eval/src/runners/codex/agent.ts:62`
- Modify: `packages/eval/src/runners/copilot/agent.ts:57`

- [ ] **Step 1: Add TODO in codex runner**

In `packages/eval/src/runners/codex/agent.ts`, immediately above the line `if (server.type === 'http') {` (line ~62), add:

```ts
    // TODO(poc/mcp): forward MCP auth headers for authenticated HTTP servers (server.auth) — codex config drops them today.
```

- [ ] **Step 2: Add TODO in copilot runner**

In `packages/eval/src/runners/copilot/agent.ts`, immediately above the line `if (server.type === 'http') {` (line ~57), add:

```ts
    // TODO(poc/mcp): forward MCP auth headers for authenticated HTTP servers (server.auth) — copilot config drops them today.
```

- [ ] **Step 3: Build to verify nothing broke**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/eval/src/runners/codex/agent.ts packages/eval/src/runners/copilot/agent.ts
git commit -m "chore(runners): note MCP auth header forwarding TODO for codex/copilot"
```

---

## Task 7: Register `auth0-hosted-mcp` in eval.config.js

**Files:**
- Modify: `apps/auth0-evals/eval.config.js`

- [ ] **Step 1: Add the server entry**

In `apps/auth0-evals/eval.config.js`, inside the `mcp.servers` object (after the existing docs MCP server entry), add:

```js
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
```

> Do NOT keep PR #443's top-level `getMcpToken()` async function or its `await`-in-config-literal usage. The framework now mints the token per job; the config stays synchronous and declarative.

- [ ] **Step 2: Build to verify config still loads**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Run the config loader tests**

Run: `npx vitest run packages/eval-core/tests/config/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/auth0-evals/eval.config.js
git commit -m "feat(config): register authenticated auth0-hosted-mcp server"
```

---

## Task 8: The `hosted_mcp_list_applications` eval

**Files:**
- Create: `apps/auth0-evals/src/evals/hosted-mcp/list-applications/PROMPT.md`
- Create: `apps/auth0-evals/src/evals/hosted-mcp/list-applications/graders.ts`

> If PR #443's versions of these files exist on this branch, overwrite them with the content below.

- [ ] **Step 1: Create PROMPT.md**

Create `apps/auth0-evals/src/evals/hosted-mcp/list-applications/PROMPT.md`:

```markdown
---
id: hosted_mcp_list_applications
name: Hosted MCP - List Applications
category: hosted-mcp
---

## Task

I need to see all the applications registered in my Auth0 tenant. List them for me.
```

- [ ] **Step 2: Create graders.ts**

Create `apps/auth0-evals/src/evals/hosted-mcp/list-applications/graders.ts`:

```ts
import { calledTool, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // L4: agent actually invoked the right MCP tool (trace-based).
    // No holistic judge: this task produces no file artifact, and the judge only
    // sees workspace files — see docs/superpowers/specs/2026-06-05-hosted-mcp-eval-design.md.
    calledTool('auth0_list_applications', 'Called the auth0_list_applications MCP tool', GraderLevel.L4),
  ];
}
```

- [ ] **Step 3: Build and confirm the eval is discovered**

Run: `npm run build && node -e "1" 2>/dev/null; npx vitest run packages/eval-graders/tests/primitives.test.ts`
Expected: build PASS. (Discovery is exercised at runtime; the smoke test in Task 10 confirms it.)

- [ ] **Step 4: Verify graders.ts imports resolve (lint)**

Run: `npm run lint`
Expected: PASS (no unresolved-import or unused-import errors in the new files).

- [ ] **Step 5: Commit**

```bash
git add apps/auth0-evals/src/evals/hosted-mcp/list-applications/PROMPT.md apps/auth0-evals/src/evals/hosted-mcp/list-applications/graders.ts
git commit -m "feat(eval): add hosted_mcp_list_applications graded on tool-call trace"
```

---

## Task 9: Documentation

**Files:**
- Modify: `AGENTS.md` (grader-primitives table)
- Modify: `docs/ADDING_EVALS.md` (grader-primitives table)

- [ ] **Step 1: Update AGENTS.md grader-primitives table**

In `AGENTS.md`, in the grader-primitives table (the one PR #376 extended with `ranCommand`/`wroteFile`), add two rows:

```markdown
| `calledTool(toolName, description, level)` | Agent invoked an MCP tool whose name contains `toolName` — event-based, level required (L4 or L5) |
| `calledToolOneOf(toolNames, description, level)` | Agent invoked at least one of the named MCP tools — event-based, level required (L4 or L5) |
```

Also, in the MCP / config section of `AGENTS.md`, add a sentence noting that authenticated HTTP MCP servers are configured with an `auth` block (`tokenUrl`, `clientId`, `clientSecret`, `audience`); the framework mints a Management API token per agent job and forwards it as a Bearer header (claude-code runner only for now).

- [ ] **Step 2: Update docs/ADDING_EVALS.md grader-primitives table**

In `docs/ADDING_EVALS.md`, add to the grader-primitives table:

```markdown
| `calledTool(toolName, description, level)` | Agent invoked an MCP tool whose name contains the substring (trace-based; L4/L5 only) |
| `calledToolOneOf(toolNames, description, level)` | Agent invoked at least one of the named MCP tools (trace-based; L4/L5 only) |
```

And add one paragraph after the event-primitives note (added by PR #376): `calledTool` / `calledToolOneOf` inspect the tool-call trace for MCP invocations (`mcp__<server>__<tool>`), match the tool name case-insensitively as a substring, and exclude errored calls. They only produce meaningful results in `--tools mcp` agent configs.

- [ ] **Step 3: Verify formatting**

Run: `npm run format`
Expected: clean (or auto-formats the markdown).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/ADDING_EVALS.md
git commit -m "docs: document calledTool primitives and authenticated MCP servers"
```

---

## Task 10: Full verification + smoke test

**Files:** none (verification only)

- [ ] **Step 1: Lint, format, build, test**

Run: `npm run lint && npm run format && npm run build && npm test`
Expected: all PASS.

- [ ] **Step 2: End-to-end smoke test (requires live creds)**

Set `MCP_TENANT_DOMAIN`, `MCP_CLIENT_ID`, `MCP_CLIENT_SECRET` (a tenant with an M2M app authorized for the Management API), then run:

Run: `npm run evals -- --eval hosted_mcp_list_applications --mode agent --tools mcp --model claude-opus-4-8 --agent-type claude-code --keep-workspace`
Expected: the run completes; the agent's trace shows an `mcp__auth0-hosted-mcp__auth0_list_applications` call; the `calledTool` L4 grader passes. If creds are unset, expect the "MCP server skipped — token mint failed or creds missing" warning and a failing L4 grader (confirms the loud-failure path).

- [ ] **Step 3: Final confirmation**

No commit. Report smoke-test outcome (pass/fail + grader result) to the user.

---

## Self-Review Notes

- **Spec coverage:** auth config (Task 1), token mint (Task 2), header forward (Task 5), codex/copilot TODOs (Task 6), `calledTool`/`calledToolOneOf` (Tasks 3-4), eval + dropped-judge deviation (Task 8), docs (Task 9), per-job minting (Task 5 mints inside the job-scoped MCP build), loud-failure path (Tasks 2/5, smoke-tested in Task 10). All spec sections mapped.
- **Type consistency:** `MCPOAuthConfig` fields (`tokenUrl`/`clientId`/`clientSecret`/`audience`) are identical across Tasks 1, 2, 7. `mintMcpToken(auth)` signature consistent across Tasks 2 and 5. `calledTool(toolName, description, level)` / `calledToolOneOf(toolNames, description, level)` consistent across Tasks 3, 4, 8, 9.
- **Dependency on PR #376:** Tasks 3-5 assume `feat/event-based-graders` is the base (provides `EventToolCall`, `EventGraderLevel`, `validateEventLevel`, the `event` executor, and `toolCalls` plumbed into `runGraders`). The branch was created off it.
