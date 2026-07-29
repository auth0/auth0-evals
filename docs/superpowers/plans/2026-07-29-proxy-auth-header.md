# Configurable Proxy Auth Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a deployment configure the HTTP header the framework uses to authenticate against its LLM proxy, so the same code runs against LiteLLM, a Bedrock proxy, or any gateway with a custom auth header.

**Architecture:** One new optional config field (`proxy.authHeader`) plus one resolver module in `evals-core` that composes the header value from an env var. Six call sites — four agent runners, the baseline runner, and the LLM judge — read the resolver and send the header via their SDK's native mechanism. When the config field is absent every call site behaves exactly as it does today.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, npm workspaces monorepo.

Spec: `docs/superpowers/specs/2026-07-29-proxy-auth-header-design.md`

## Global Constraints

- **ESM imports:** every relative import needs a `.js` extension even when importing `.ts` source. Use `node:` prefix for builtins. `import type` for type-only imports.
- **Tests are mandatory:** every new function needs a happy-path test and a failure/edge-case test. Tests live in the package where the changed code lives (`packages/evals-core/tests/`, `packages/evals/tests/`).
- **Never log the token value.** Log the header *name* only. `logger.warn` messages name the env var, never its contents.
- **The default path must not change.** When `proxy.authHeader` is absent, every call site must behave byte-for-byte as it does today. Each runner task includes a regression test asserting this.
- **Placeholder value:** `PLACEHOLDER_API_KEY = 'unused-see-proxy-auth-header'` — exact string, defined once in Task 1 and imported everywhere else.
- **Codex proxy token env var:** `LLM_PROXY_AUTH_TOKEN` — exact string, the fixed name used inside the codex subprocess only.
- **Run `npm run lint` and `npm run format`** before each commit. Run them in this worktree, not elsewhere.
- **Verified SDK mechanisms** (do not substitute alternatives): claude-code → `ANTHROPIC_CUSTOM_HEADERS` (newline-separated `Name: Value`); codex → `env_http_headers` TOML table; copilot → `ProviderConfig.headers`; gemini-cli → `GEMINI_CLI_CUSTOM_HEADERS` (comma-separated `Name: Value`); baseline → `OpenAIProviderSettings.headers`; judge → `fetch` headers.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `packages/evals-core/src/config/proxy-auth.ts` | The only place the auth header is composed. Exports `resolveProxyAuthHeader()`, `ResolvedProxyAuth`, `PLACEHOLDER_API_KEY`. |
| `packages/evals-core/tests/config/proxy-auth.test.ts` | Unit tests for the resolver. |

**Modified:**

| File | Change |
| --- | --- |
| `packages/evals-core/src/config/framework.ts` | Add `ProxyAuthHeaderConfig`; add `authHeader?` to `ProxyConfig`. |
| `packages/evals-core/src/index.ts` | Re-export the new symbols. |
| `packages/evals-core/src/graders/llm-judge.ts` | Send the header; drop `Authorization` when configured. |
| `packages/evals/src/runners/claude-code/agent.ts` | Set `ANTHROPIC_CUSTOM_HEADERS`. |
| `packages/evals/src/runners/codex/agent.ts` | Emit `env_http_headers`; inject `LLM_PROXY_AUTH_TOKEN`. |
| `packages/evals/src/runners/gemini-cli/agent.ts` | Set `GEMINI_CLI_CUSTOM_HEADERS`. |
| `packages/evals/src/runners/copilot/agent.ts` | Add `headers` to `ProviderConfig`. |
| `packages/evals/src/runners/baseline.ts` | Add `headers` to `createOpenAI`. |
| `AGENTS.md`, `packages/evals/README.md`, `apps/auth0-evals/.env.example` | Docs. |

Tasks 3–8 each touch exactly one call site and are independently reviewable. Task 1 must land first — everything imports from it.

---

### Task 1: Config type + resolver

**Files:**
- Create: `packages/evals-core/src/config/proxy-auth.ts`
- Create: `packages/evals-core/tests/config/proxy-auth.test.ts`
- Modify: `packages/evals-core/src/config/framework.ts:13-18` (the `ProxyConfig` interface)
- Modify: `packages/evals-core/src/index.ts:78` (add an export line after the `mcp-auth.js` export)

**Interfaces:**
- Consumes: `getFrameworkConfig()` from `./framework-config.js`, `logger` from `../utils/logger.js`.
- Produces — every later task imports these from `@a0/evals-core`:
  - `resolveProxyAuthHeader(): ResolvedProxyAuth | undefined`
  - `interface ResolvedProxyAuth { name: string; value: string; tokenEnv: string }`
  - `const PLACEHOLDER_API_KEY: string` (value `'unused-see-proxy-auth-header'`)
  - `interface ProxyAuthHeaderConfig { name: string; valuePrefix?: string; tokenEnv: string }`

- [ ] **Step 1: Add the config types**

In `packages/evals-core/src/config/framework.ts`, replace the existing `ProxyConfig` interface (currently lines 13-18) with:

```typescript
export interface ProxyAuthHeaderConfig {
  /** Header name, e.g. 'x-litellm-api-key'. */
  name: string;
  /** Prefix prepended to the token, e.g. 'Bearer '. Defaults to ''. */
  valuePrefix?: string;
  /** Name of the env var holding the raw token. */
  tokenEnv: string;
}

export interface ProxyConfig {
  /** LLM API base URL. */
  baseUrl: string;
  /** API key for the proxy. Callers must supply this explicitly (e.g. from `LLM_API_KEY` env var). */
  apiKey?: string;
  /**
   * When set, the framework sends this header on every proxy request instead of
   * the provider-native API-key header. Absent → today's `LLM_API_KEY` behaviour.
   */
  authHeader?: ProxyAuthHeaderConfig;
}
```

Note: `DEFAULT_FRAMEWORK_CONFIG` in `defaults.ts` needs no change — `authHeader` is optional and its absence is the default.

- [ ] **Step 2: Write the failing tests**

Create `packages/evals-core/tests/config/proxy-auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FrameworkConfig, ProxyAuthHeaderConfig } from '../../src/config/framework.js';

describe('resolveProxyAuthHeader', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /**
   * Loads a fresh copy of the module graph and seeds the config singleton.
   * vi.resetModules() is required because framework-config.ts holds module state.
   */
  async function withConfig(authHeader?: ProxyAuthHeaderConfig) {
    const { setFrameworkConfig } = await import('../../src/config/framework-config.js');
    setFrameworkConfig({
      evalsDir: '/evals',
      proxy: { baseUrl: 'https://llm.example.com/v1', ...(authHeader ? { authHeader } : {}) },
      mcp: { servers: {} },
      judge: { model: 'm', maxTokens: 1024, maxCodeChars: 16384 },
      models: { known: [], default: '', modelIds: {} },
      agents: {},
    } as unknown as Required<FrameworkConfig>);
    return await import('../../src/config/proxy-auth.js');
  }

  it('returns undefined when proxy.authHeader is not configured', async () => {
    const { resolveProxyAuthHeader } = await withConfig();
    expect(resolveProxyAuthHeader()).toBeUndefined();
  });

  it('composes valuePrefix + token when configured and the env var is set', async () => {
    vi.stubEnv('MY_PROXY_TOKEN', 'jwt-abc');
    const { resolveProxyAuthHeader } = await withConfig({
      name: 'x-litellm-api-key',
      valuePrefix: 'Bearer ',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
    expect(resolveProxyAuthHeader()).toEqual({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-abc',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
  });

  it('returns the bare token when valuePrefix is omitted', async () => {
    vi.stubEnv('MY_PROXY_TOKEN', 'jwt-abc');
    const { resolveProxyAuthHeader } = await withConfig({
      name: 'x-api-key',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
    expect(resolveProxyAuthHeader()?.value).toBe('jwt-abc');
  });

  it('returns undefined and warns when the token env var is unset', async () => {
    vi.stubEnv('MY_PROXY_TOKEN', '');
    const mod = await withConfig({ name: 'x-api-key', tokenEnv: 'MY_PROXY_TOKEN' });
    const { logger } = await import('../../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(mod.resolveProxyAuthHeader()).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    // The warning must name the env var so a forgotten export is obvious.
    expect(warn.mock.calls[0]![0]).toContain('MY_PROXY_TOKEN');
  });

  it('never includes the token value in the warning', async () => {
    vi.stubEnv('MY_PROXY_TOKEN', '');
    const mod = await withConfig({ name: 'x-api-key', tokenEnv: 'MY_PROXY_TOKEN' });
    const { logger } = await import('../../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mod.resolveProxyAuthHeader();
    expect(String(warn.mock.calls[0]![0])).not.toContain('jwt');
  });

  it('exposes the exact placeholder string', async () => {
    const { PLACEHOLDER_API_KEY } = await withConfig();
    expect(PLACEHOLDER_API_KEY).toBe('unused-see-proxy-auth-header');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/evals-core/tests/config/proxy-auth.test.ts`
Expected: FAIL — `Cannot find module '../../src/config/proxy-auth.js'`

- [ ] **Step 4: Write the resolver**

Create `packages/evals-core/src/config/proxy-auth.ts`:

```typescript
/**
 * Proxy auth header resolution.
 *
 * The single place the configured auth header is composed. Every proxy call site
 * — the four agent runners, the baseline runner, and the LLM judge — reads this
 * rather than assembling a header itself, so the name/prefix/token rules live in
 * exactly one place.
 *
 * When `proxy.authHeader` is unset this returns `undefined` and callers fall back
 * to injecting `LLM_API_KEY` into the provider-native key var, which is the
 * framework's original behaviour.
 */

import { getFrameworkConfig } from './framework-config.js';
import { logger } from '../utils/logger.js';

export interface ResolvedProxyAuth {
  /** Header name, verbatim from config. */
  name: string;
  /** Composed header value: `valuePrefix + token`. Secret — never log this. */
  value: string;
  /** Env var the token was read from. Used by the Codex runner, which passes an env-var name rather than a value. */
  tokenEnv: string;
}

/**
 * Inert value written to provider-native API-key vars (`ANTHROPIC_API_KEY`,
 * `GEMINI_API_KEY`, …) when an auth header is configured.
 *
 * It cannot simply be omitted: the Gemini CLI's `validateAuthMethod` rejects the
 * run unless `GEMINI_API_KEY` is non-empty, and the Claude binary requires one of
 * its credential vars to be present. Setting a placeholder satisfies those
 * validators while keeping the real token out of any provider-native header.
 * The text is self-describing so it reads as intentional if it ever surfaces in
 * a proxy error message.
 */
export const PLACEHOLDER_API_KEY = 'unused-see-proxy-auth-header';

/**
 * Resolves the configured proxy auth header, or `undefined` when none is
 * configured or its token env var is empty.
 *
 * A configured-but-empty token is treated as "not configured" and warns: failing
 * closed here would break every run on a typo'd env var name, whereas the warning
 * surfaces the misconfiguration at startup rather than as an opaque 401 mid-run.
 * This mirrors how `mintMcpToken` reports a failed mint.
 */
export function resolveProxyAuthHeader(): ResolvedProxyAuth | undefined {
  const { authHeader } = getFrameworkConfig().proxy;
  if (!authHeader) return undefined;

  const token = process.env[authHeader.tokenEnv];
  if (!token) {
    logger.warn(
      `[proxy-auth] proxy.authHeader is configured but ${authHeader.tokenEnv} is not set — ` +
        `falling back to the provider-native API key. Proxy requests will likely fail.`,
    );
    return undefined;
  }

  return {
    name: authHeader.name,
    value: `${authHeader.valuePrefix ?? ''}${token}`,
    tokenEnv: authHeader.tokenEnv,
  };
}
```

- [ ] **Step 5: Export from the package index**

In `packages/evals-core/src/index.ts`, immediately after the existing line 78 (`export { mintMcpToken, mcpBearerTokenEnvVar } from './config/mcp-auth.js';`) add:

```typescript
export { resolveProxyAuthHeader, PLACEHOLDER_API_KEY } from './config/proxy-auth.js';
export type { ResolvedProxyAuth } from './config/proxy-auth.js';
```

The `export type { ... } from './config/framework.js'` block (lines 57-74) enumerates every type name explicitly, so `ProxyAuthHeaderConfig` must be added to it. Insert it immediately after `ProxyConfig,`:

```typescript
export type {
  FrameworkConfig,
  ProxyConfig,
  ProxyAuthHeaderConfig,
  MCPConfig,
  // ... rest unchanged
} from './config/framework.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/evals-core/tests/config/proxy-auth.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 7: Verify the whole suite and build still pass**

Run: `npm run build && npm test`
Expected: PASS. The build must succeed — a type error in `framework.ts` breaks every downstream package.

- [ ] **Step 8: Lint, format, commit**

```bash
npm run lint && npm run format
git add packages/evals-core/src/config/proxy-auth.ts \
        packages/evals-core/tests/config/proxy-auth.test.ts \
        packages/evals-core/src/config/framework.ts \
        packages/evals-core/src/index.ts
git commit -m "feat: add configurable proxy auth header resolver"
```

---

### Task 2: LLM judge sends the header

**Files:**
- Modify: `packages/evals-core/src/graders/llm-judge.ts:79-88` (the `fetch` call)
- Test: `packages/evals-core/tests/graders/llm-judge-auth.test.ts` (create)

**Interfaces:**
- Consumes: `resolveProxyAuthHeader` from `../config/proxy-auth.js` (Task 1).
- Produces: nothing new. `LlmJudgeOptions` is unchanged — the judge reads config directly, as it already does for nothing else, so the resolver call sits inside `llmJudge`.

The judge is done before the runners because it is the smallest edit and it proves the resolver works end-to-end against a real `fetch`.

- [ ] **Step 1: Write the failing test**

Create `packages/evals-core/tests/graders/llm-judge-auth.test.ts`:

```typescript
/**
 * Verifies the judge's outbound auth. When proxy.authHeader is configured the
 * credential travels in that header alone; otherwise the original
 * `Authorization: Bearer <apiKey>` is sent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FrameworkConfig, ProxyAuthHeaderConfig } from '../../src/config/framework.js';

const okResponse = {
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'yes' } }], usage: {} }),
  text: async () => '',
};

describe('llmJudge auth header', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function callJudge(authHeader?: ProxyAuthHeaderConfig) {
    const { setFrameworkConfig } = await import('../../src/config/framework-config.js');
    setFrameworkConfig({
      evalsDir: '/evals',
      proxy: { baseUrl: 'https://llm.example.com/v1', ...(authHeader ? { authHeader } : {}) },
      mcp: { servers: {} },
      judge: { model: 'm', maxTokens: 1024, maxCodeChars: 16384 },
      models: { known: [], default: '', modelIds: {} },
      agents: {},
    } as unknown as Required<FrameworkConfig>);

    const fetchMock = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal('fetch', fetchMock);

    const { llmJudge } = await import('../../src/graders/llm-judge.js');
    await llmJudge({
      question: 'Is it wired up?',
      code: '// code',
      apiKey: 'plain-api-key',
      model: 'claude-opus-5',
      baseUrl: 'https://llm.example.com/v1',
    });

    return (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
  }

  it('sends Authorization: Bearer <apiKey> when no auth header is configured', async () => {
    const headers = await callJudge();
    expect(headers.Authorization).toBe('Bearer plain-api-key');
  });

  it('sends the configured header and drops Authorization when configured', async () => {
    vi.stubEnv('PROXY_TOKEN', 'jwt-xyz');
    const headers = await callJudge({
      name: 'x-litellm-api-key',
      valuePrefix: 'Bearer ',
      tokenEnv: 'PROXY_TOKEN',
    });
    expect(headers['x-litellm-api-key']).toBe('Bearer jwt-xyz');
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('keeps Content-Type in both modes', async () => {
    vi.stubEnv('PROXY_TOKEN', 'jwt-xyz');
    const headers = await callJudge({ name: 'x-api-key', tokenEnv: 'PROXY_TOKEN' });
    expect(headers['Content-Type']).toBe('application/json');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/evals-core/tests/graders/llm-judge-auth.test.ts`
Expected: FAIL — the second test fails because `x-litellm-api-key` is absent and `Authorization` is still set.

- [ ] **Step 3: Implement**

In `packages/evals-core/src/graders/llm-judge.ts`, add to the imports at the top of the file (after the existing `import { logger } from '../utils/logger.js';`):

```typescript
import { resolveProxyAuthHeader } from '../config/proxy-auth.js';
```

Then, immediately before the `try {` that wraps the `withRetry` call, add:

```typescript
  // When a proxy auth header is configured the credential travels in that header
  // alone. Unlike the CLI runners the judge has no validator demanding a
  // credential field, so `Authorization` is dropped rather than given a placeholder.
  const proxyAuth = resolveProxyAuthHeader();
  const authHeaders: Record<string, string> = proxyAuth
    ? { [proxyAuth.name]: proxyAuth.value }
    : { Authorization: `Bearer ${apiKey}` };
```

Then replace the `headers` object in the `fetch` call (currently lines 81-84) with:

```typescript
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/evals-core/tests/graders/llm-judge-auth.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Verify no judge regressions**

Run: `npx vitest run packages/evals-core`
Expected: PASS. `tests/graders/engine.test.ts` exercises the judge and must be unaffected.

- [ ] **Step 6: Lint, format, commit**

```bash
npm run lint && npm run format
git add packages/evals-core/src/graders/llm-judge.ts packages/evals-core/tests/graders/llm-judge-auth.test.ts
git commit -m "feat: send configured auth header from LLM judge"
```

---

### Task 3: claude-code runner

**Files:**
- Modify: `packages/evals/src/runners/claude-code/agent.ts:36` (import), `:119-126` (the `proxyEnv` block)
- Test: `packages/evals/tests/runners/claude-code-agent.test.ts` (extend the existing `describe('runClaudeCodeAgent proxy env injection')` block, which starts at line 865)

**Interfaces:**
- Consumes: `resolveProxyAuthHeader`, `PLACEHOLDER_API_KEY` from `@a0/evals-core` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the existing `describe('runClaudeCodeAgent proxy env injection', ...)` block in `packages/evals/tests/runners/claude-code-agent.test.ts`, just before its closing `});`.

This test file mocks `@a0/evals-core`; check how the existing mock factory is declared near the top of the file and add `resolveProxyAuthHeader` to it as a `vi.hoisted` mock so these tests can drive it. If the file uses `vi.importActual` spread (as `codex-agent.test.ts` does at line 55), add the override alongside the existing keys:

```typescript
  it('sets ANTHROPIC_CUSTOM_HEADERS when a proxy auth header is configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-atko-token');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await runClaudeCodeAgent(evalDef, workspace);
    expect(capturedEnv().ANTHROPIC_CUSTOM_HEADERS).toBe('x-litellm-api-key: Bearer jwt-xyz');
  });

  it('sets ANTHROPIC_API_KEY to the placeholder when a proxy auth header is configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-atko-token');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await runClaudeCodeAgent(evalDef, workspace);
    expect(capturedEnv().ANTHROPIC_API_KEY).toBe('unused-see-proxy-auth-header');
  });

  it('does not set ANTHROPIC_CUSTOM_HEADERS when no proxy auth header is configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-atko-token');
    mockResolveProxyAuthHeader.mockReturnValue(undefined);
    await runClaudeCodeAgent(evalDef, workspace);
    expect(capturedEnv()).not.toHaveProperty('ANTHROPIC_CUSTOM_HEADERS');
    expect(capturedEnv().ANTHROPIC_API_KEY).toBe('test-atko-token');
  });
```

Add `mockResolveProxyAuthHeader.mockReturnValue(undefined);` to this describe block's `beforeEach` so the two pre-existing tests in it (`sets ANTHROPIC_API_KEY from LLM_API_KEY`, `does not set ANTHROPIC_API_KEY when LLM_API_KEY is absent`) keep passing unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/evals/tests/runners/claude-code-agent.test.ts -t 'proxy env injection'`
Expected: FAIL — `ANTHROPIC_CUSTOM_HEADERS` is undefined.

- [ ] **Step 3: Implement**

In `packages/evals/src/runners/claude-code/agent.ts`, add `resolveProxyAuthHeader` and `PLACEHOLDER_API_KEY` to the existing `@a0/evals-core` import block (the one ending around line 34 that already imports `getAgentProxyBaseUrl`, `mintMcpToken`, etc.).

Replace the current block at lines 119-126:

```typescript
  const proxyEnv: Record<string, string> = {
    ANTHROPIC_BASE_URL: getAnthropicProxyUrl(),
  };
  if (process.env[LLM_API_KEY_ENV]) {
    proxyEnv.ANTHROPIC_API_KEY = process.env[LLM_API_KEY_ENV]!;
  }
```

with:

```typescript
  const proxyEnv: Record<string, string> = {
    ANTHROPIC_BASE_URL: getAnthropicProxyUrl(),
  };
  // When a proxy auth header is configured, the credential rides that header.
  // ANTHROPIC_API_KEY still has to be non-empty — the Claude binary requires one
  // of its credential vars to be set — so it gets an inert placeholder.
  // ANTHROPIC_CUSTOM_HEADERS is newline-separated `Name: Value` pairs.
  const proxyAuth = resolveProxyAuthHeader();
  if (proxyAuth) {
    proxyEnv.ANTHROPIC_CUSTOM_HEADERS = `${proxyAuth.name}: ${proxyAuth.value}`;
    proxyEnv.ANTHROPIC_API_KEY = PLACEHOLDER_API_KEY;
    logger.info(`[ClaudeCode] Proxy auth header: ${proxyAuth.name}`);
  } else if (process.env[LLM_API_KEY_ENV]) {
    proxyEnv.ANTHROPIC_API_KEY = process.env[LLM_API_KEY_ENV]!;
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/evals/tests/runners/claude-code-agent.test.ts`
Expected: PASS — all tests in the file, including the two pre-existing proxy tests.

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint && npm run format
git add packages/evals/src/runners/claude-code/agent.ts packages/evals/tests/runners/claude-code-agent.test.ts
git commit -m "feat: send configured auth header from claude-code runner"
```

---

### Task 4: gemini-cli runner

**Files:**
- Modify: `packages/evals/src/runners/gemini-cli/agent.ts:24-34` (import block), `:240-245` (the env block)
- Test: `packages/evals/tests/runners/gemini-cli-proxy.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveProxyAuthHeader`, `PLACEHOLDER_API_KEY` from `@a0/evals-core` (Task 1).
- Produces: nothing consumed by later tasks.

`GEMINI_CLI_CUSTOM_HEADERS` is comma-separated `Name: Value` (parsed at `@google/gemini-cli/bundle/chunk-BVT2OZGG.js:302939`). We send exactly one header, so no comma is involved — but do not switch to newline separation, which that parser does not accept.

- [ ] **Step 1: Write the failing tests**

`packages/evals/tests/runners/gemini-cli-proxy.test.ts` already mocks `@a0/evals-core` at line 16. Add `resolveProxyAuthHeader` to that mock factory as a hoisted mock:

```typescript
const mockResolveProxyAuthHeader = vi.hoisted(() => vi.fn().mockReturnValue(undefined));
```

and add `resolveProxyAuthHeader: mockResolveProxyAuthHeader,` to the object returned by the `vi.mock('@a0/evals-core', ...)` factory.

Add `mockResolveProxyAuthHeader.mockReturnValue(undefined);` to the existing `beforeEach` (line 39) so the four current tests are unaffected.

Then append this describe block at the end of the file:

```typescript
describe('runGeminiCliAgent proxy auth header', () => {
  it('sets GEMINI_CLI_CUSTOM_HEADERS when configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await triggerRun();
    expect(capturedEnv().GEMINI_CLI_CUSTOM_HEADERS).toBe('x-litellm-api-key: Bearer jwt-xyz');
  });

  it('sets GEMINI_API_KEY to the placeholder when configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await triggerRun();
    // Non-empty is mandatory: validateAuthMethod rejects the run otherwise.
    expect(capturedEnv().GEMINI_API_KEY).toBe('unused-see-proxy-auth-header');
  });

  it('still routes through the proxy base URL when configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await triggerRun();
    expect(capturedEnv().GOOGLE_GEMINI_BASE_URL).toBe('http://127.0.0.1:12345');
  });

  it('sets the header even when LLM_API_KEY is absent', async () => {
    // The auth header is the credential; LLM_API_KEY is irrelevant in this mode.
    vi.stubEnv('LLM_API_KEY', '');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await triggerRun();
    expect(capturedEnv().GEMINI_CLI_CUSTOM_HEADERS).toBe('x-litellm-api-key: Bearer jwt-xyz');
    expect(capturedEnv().GOOGLE_GEMINI_BASE_URL).toBe('http://127.0.0.1:12345');
  });

  it('does not set GEMINI_CLI_CUSTOM_HEADERS when not configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    mockResolveProxyAuthHeader.mockReturnValue(undefined);
    await triggerRun();
    expect(capturedEnv()).not.toHaveProperty('GEMINI_CLI_CUSTOM_HEADERS');
    expect(capturedEnv().GEMINI_API_KEY).toBe('test-llm-token');
  });
});
```

The fourth test encodes a real behaviour change: today an unset `LLM_API_KEY` means the CLI never gets a base URL. With a header configured the run must still be routed and authenticated.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/evals/tests/runners/gemini-cli-proxy.test.ts`
Expected: FAIL — `GEMINI_CLI_CUSTOM_HEADERS` undefined.

- [ ] **Step 3: Implement**

Add `resolveProxyAuthHeader` and `PLACEHOLDER_API_KEY` to the `@a0/evals-core` import block at lines 24-34.

Replace lines 240-245:

```typescript
  if (process.env[LLM_API_KEY_ENV]) {
    geminiEnv.GOOGLE_GEMINI_BASE_URL = getAgentProxyBaseUrl('gemini-cli');
    geminiEnv.GEMINI_API_KEY = process.env[LLM_API_KEY_ENV]!;
  } else {
    logger.warn(`[GeminiCLI] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
```

with:

```typescript
  // Gemini CLI 0.51+ reads GEMINI_CLI_CUSTOM_HEADERS (comma-separated
  // `Name: Value`) and merges it into the headers sent to the model endpoint, so
  // no header-injecting shim is needed. GEMINI_API_KEY must still be non-empty —
  // validateAuthMethod rejects a `gemini-api-key` run without it — so it gets an
  // inert placeholder while the real credential rides the custom header.
  const proxyAuth = resolveProxyAuthHeader();
  if (proxyAuth) {
    geminiEnv.GOOGLE_GEMINI_BASE_URL = getAgentProxyBaseUrl('gemini-cli');
    geminiEnv.GEMINI_CLI_CUSTOM_HEADERS = `${proxyAuth.name}: ${proxyAuth.value}`;
    geminiEnv.GEMINI_API_KEY = PLACEHOLDER_API_KEY;
    logger.info(`[GeminiCLI] Proxy auth header: ${proxyAuth.name}`);
  } else if (process.env[LLM_API_KEY_ENV]) {
    geminiEnv.GOOGLE_GEMINI_BASE_URL = getAgentProxyBaseUrl('gemini-cli');
    geminiEnv.GEMINI_API_KEY = process.env[LLM_API_KEY_ENV]!;
  } else {
    logger.warn(`[GeminiCLI] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/evals/tests/runners/gemini-cli-proxy.test.ts packages/evals/tests/runners/gemini-cli-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint && npm run format
git add packages/evals/src/runners/gemini-cli/agent.ts packages/evals/tests/runners/gemini-cli-proxy.test.ts
git commit -m "feat: send configured auth header from gemini-cli runner"
```

---

### Task 5: copilot runner

**Files:**
- Modify: `packages/evals/src/runners/copilot/agent.ts:33` area (imports), `:141-147` (apiKey resolution), `:185-191` (the `provider` block)
- Test: `packages/evals/tests/runners/copilot-agent.test.ts` (extend `describe('runCopilotAgent — proxy provider')`, line 867)

**Interfaces:**
- Consumes: `resolveProxyAuthHeader`, `PLACEHOLDER_API_KEY` from `@a0/evals-core` (Task 1).
- Produces: nothing consumed by later tasks.

`ProviderConfig.headers` is `{ [k: string]: string | undefined }`, verified at `@github/copilot-sdk/dist/generated/rpc.d.ts:7281`. The SDK also offers `bearerToken`, but that hardcodes `Authorization` — we need an arbitrary header name, so use `headers`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('runCopilotAgent — proxy provider', ...)` block. Add `resolveProxyAuthHeader` to this file's `@a0/evals-core` mock as a hoisted mock named `mockResolveProxyAuthHeader`, defaulting to `undefined`, and reset it to `undefined` in the block's `beforeEach`:

```typescript
  it('passes the configured auth header in provider.headers', async () => {
    process.env.LLM_API_KEY = 'test-key';
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace, { model: 'gpt-5.4' });
    const config = mockCreateSession.mock.calls[0][0];
    expect(config.provider.headers).toEqual({ 'x-litellm-api-key': 'Bearer jwt-xyz' });
  });

  it('sets provider.apiKey to the placeholder when an auth header is configured', async () => {
    process.env.LLM_API_KEY = 'test-key';
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace, { model: 'gpt-5.4' });
    const config = mockCreateSession.mock.calls[0][0];
    expect(config.provider.apiKey).toBe('unused-see-proxy-auth-header');
  });

  it('omits provider.headers when no auth header is configured', async () => {
    process.env.LLM_API_KEY = 'test-key';
    mockResolveProxyAuthHeader.mockReturnValue(undefined);
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace, { model: 'gpt-5.4' });
    const config = mockCreateSession.mock.calls[0][0];
    expect(config.provider.headers).toBeUndefined();
    expect(config.provider.apiKey).toBe('test-key');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/evals/tests/runners/copilot-agent.test.ts -t 'proxy provider'`
Expected: FAIL — `provider.headers` is undefined.

- [ ] **Step 3: Implement**

Add `resolveProxyAuthHeader` and `PLACEHOLDER_API_KEY` to the `@a0/evals-core` import.

Replace lines 144-147:

```typescript
  const apiKey = process.env[LLM_API_KEY_ENV];
  if (!apiKey) {
    logger.warn(`[Copilot] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
```

with:

```typescript
  // When a proxy auth header is configured the credential rides that header and
  // apiKey becomes an inert placeholder. `headers` (not `bearerToken`) is used
  // because bearerToken hardcodes the Authorization header name.
  const proxyAuth = resolveProxyAuthHeader();
  const apiKey = proxyAuth ? PLACEHOLDER_API_KEY : process.env[LLM_API_KEY_ENV];
  if (proxyAuth) {
    logger.info(`[Copilot] Proxy auth header: ${proxyAuth.name}`);
  } else if (!apiKey) {
    logger.warn(`[Copilot] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
```

Then in the `provider` object (lines 185-191), add the headers line after `modelId: model,`:

```typescript
    provider: {
      type: 'openai',
      wireApi: 'responses',
      baseUrl: proxyApiUrl,
      apiKey,
      modelId: model,
      ...(proxyAuth ? { headers: { [proxyAuth.name]: proxyAuth.value } } : {}),
    } satisfies ProviderConfig,
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/evals/tests/runners/copilot-agent.test.ts`
Expected: PASS — including the three pre-existing proxy-provider tests.

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint && npm run format
git add packages/evals/src/runners/copilot/agent.ts packages/evals/tests/runners/copilot-agent.test.ts
git commit -m "feat: send configured auth header from copilot runner"
```

---

### Task 6: codex runner

**Files:**
- Modify: `packages/evals/src/runners/codex/agent.ts:44` area (imports), `:100-126` (`writeCodexConfig`), `:508-510` (the `writeCodexConfig` call site), `:522-528` (the `codexEnv` block)
- Test: `packages/evals/tests/runners/codex-agent.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveProxyAuthHeader`, `PLACEHOLDER_API_KEY` from `@a0/evals-core` (Task 1).
- Produces: nothing consumed by later tasks.

This is the one asymmetric runner. `env_http_headers` maps a header name to an **env var name**, so the token never lands in `config.toml`. Inside the subprocess the token is injected under the fixed name `LLM_PROXY_AUTH_TOKEN` — not the app's `tokenEnv` — because `filteredEnv()` strips anything outside its allowlist, and because an app-chosen name could otherwise collide with a codex config key.

- [ ] **Step 1: Write the failing tests**

Add `resolveProxyAuthHeader` to the existing `vi.mock('@a0/evals-core', ...)` factory (line 55) as a hoisted mock defaulting to `undefined`, and reset it in the top-level `beforeEach`. Then append this describe block:

```typescript
describe('proxy auth header', () => {
  beforeEach(() => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
      mcp: { servers: {} },
    });
  });

  function writtenToml(): string {
    const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).endsWith('config.toml'),
    );
    expect(written).toBeDefined();
    return written![1] as string;
  }

  it('writes env_http_headers referencing the fixed token env var', async () => {
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

    await runCodexAgent(evalDef, workspace);

    const toml = writtenToml();
    expect(toml).toContain('[model_providers.llmproxy.env_http_headers]');
    expect(toml).toContain('"x-litellm-api-key" = "LLM_PROXY_AUTH_TOKEN"');
  });

  it('never writes the token value into config.toml', async () => {
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

    await runCodexAgent(evalDef, workspace);

    expect(writtenToml()).not.toContain('jwt-xyz');
  });

  it('omits env_http_headers when no auth header is configured', async () => {
    mockResolveProxyAuthHeader.mockReturnValue(undefined);
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

    await runCodexAgent(evalDef, workspace);

    expect(writtenToml()).not.toContain('env_http_headers');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/evals/tests/runners/codex-agent.test.ts -t 'proxy auth header'`
Expected: FAIL — `env_http_headers` absent from the TOML.

- [ ] **Step 3: Implement the config-file change**

Add `resolveProxyAuthHeader` and `PLACEHOLDER_API_KEY` to the `@a0/evals-core` import.

Below the existing imports, add the fixed env-var name constant:

```typescript
/**
 * Env var the proxy auth token is injected under inside the Codex subprocess.
 *
 * Fixed rather than the app's configured `tokenEnv`: `filteredEnv()` strips
 * everything outside its allowlist, so the app-facing name would not survive into
 * the subprocess, and a fixed name cannot collide with a Codex config key.
 * `config.toml` references this name via `env_http_headers`, so the token itself
 * is never written to disk.
 */
const CODEX_PROXY_AUTH_TOKEN_ENV = 'LLM_PROXY_AUTH_TOKEN';
```

Change the `writeCodexConfig` signature and body. Replace lines 100-126 with:

```typescript
function writeCodexConfig(
  codexHome: string,
  proxyBaseUrl: string,
  workspace: string,
  mcpServers: Record<string, MCPServerConfig> = {},
  bearerTokenEnvVars: Record<string, string> = {},
  proxyAuthHeaderName?: string,
): void {
  mkdirSync(codexHome, { recursive: true });
  // Resolve canonical path — on macOS /var is a symlink to /private/var.
  // Codex stores trusted project paths canonically, so we must match that.
  const resolvedWorkspace = tomlEscape(realpathSync(workspace));
  const safeBaseUrl = tomlEscape(proxyBaseUrl);
  // `env_http_headers` maps a header name to an ENV VAR NAME, so the token is
  // resolved by Codex at runtime and never written to this file — the same
  // reasoning behind `bearer_token_env_var` for authenticated MCP servers.
  const authHeaderToml = proxyAuthHeaderName
    ? `\n[model_providers.llmproxy.env_http_headers]\n"${tomlEscape(proxyAuthHeaderName)}" = "${CODEX_PROXY_AUTH_TOKEN_ENV}"\n`
    : '';
  const configToml = `model_provider = "llmproxy"
model_reasoning_effort = "medium"

[model_providers.llmproxy]
name = "LLM Proxy"
base_url = "${safeBaseUrl}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
${authHeaderToml}
[projects."${resolvedWorkspace}"]
trust_level = "trusted"
${buildMcpToml(mcpServers, bearerTokenEnvVars)}`;
  writeFileSync(join(codexHome, 'config.toml'), configToml, 'utf-8');
}
```

- [ ] **Step 4: Implement the call site and env injection**

At the `writeCodexConfig` call (around line 510), resolve the header first and pass its name. Replace:

```typescript
  writeCodexConfig(codexHome, codexApiUrl, workspace, mcpServers, bearerTokenEnvVars);
```

with:

```typescript
  const proxyAuth = resolveProxyAuthHeader();
  writeCodexConfig(codexHome, codexApiUrl, workspace, mcpServers, bearerTokenEnvVars, proxyAuth?.name);
  if (proxyAuth) logger.info(`[Codex] Proxy auth header: ${proxyAuth.name}`);
```

Then replace the `codexEnv` API-key block (lines 523-528):

```typescript
  const codexEnv: Record<string, string> = { ...filteredEnv() };
  if (process.env[LLM_API_KEY_ENV]) {
    codexEnv.OPENAI_API_KEY = process.env[LLM_API_KEY_ENV]!;
  } else {
    logger.warn(`[Codex] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
```

with:

```typescript
  const codexEnv: Record<string, string> = { ...filteredEnv() };
  if (proxyAuth) {
    // The real credential reaches Codex only through this env var, which
    // config.toml references by name via env_http_headers.
    codexEnv[CODEX_PROXY_AUTH_TOKEN_ENV] = proxyAuth.value;
    codexEnv.OPENAI_API_KEY = PLACEHOLDER_API_KEY;
  } else if (process.env[LLM_API_KEY_ENV]) {
    codexEnv.OPENAI_API_KEY = process.env[LLM_API_KEY_ENV]!;
  } else {
    logger.warn(`[Codex] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
```

`env_key = "OPENAI_API_KEY"` stays in the TOML: Codex requires the provider to declare one, and it now resolves to the placeholder.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run packages/evals/tests/runners/codex-agent.test.ts`
Expected: PASS — including the four pre-existing `config.toml` tests, which assert MCP blocks and must be unaffected.

- [ ] **Step 6: Lint, format, commit**

```bash
npm run lint && npm run format
git add packages/evals/src/runners/codex/agent.ts packages/evals/tests/runners/codex-agent.test.ts
git commit -m "feat: send configured auth header from codex runner"
```

---

### Task 7: baseline runner

**Files:**
- Modify: `packages/evals/src/runners/baseline.ts` (imports and `llmCall`, lines 59-79)
- Test: `packages/evals/tests/baseline.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveProxyAuthHeader`, `PLACEHOLDER_API_KEY` from `@a0/evals-core` (Task 1).
- Produces: nothing consumed by later tasks.

Baseline is a single non-agentic LLM call. A proxy that rejects unauthenticated requests rejects this one too, so it needs the header just as much as the runners. `OpenAIProviderSettings.headers` is verified at `@ai-sdk/openai/dist/index.d.ts:1226`.

- [ ] **Step 1: Write the failing tests**

`packages/evals/tests/baseline.test.ts` already mocks `@ai-sdk/openai` with `mockCreateOpenAI` (line 20). Add a hoisted `mockResolveProxyAuthHeader` and mock `@a0/evals-core` to override just that export, preserving the rest:

```typescript
const mockResolveProxyAuthHeader = vi.hoisted(() => vi.fn().mockReturnValue(undefined));

vi.mock('@a0/evals-core', async () => ({
  ...(await vi.importActual('@a0/evals-core')),
  resolveProxyAuthHeader: mockResolveProxyAuthHeader,
}));
```

Then append:

```typescript
describe('llmCall proxy auth header', () => {
  beforeEach(() => {
    mockCreateOpenAI.mockClear();
    mockCreateOpenAI.mockReturnValue(() => 'stub-model');
    mockGenerateText.mockResolvedValue(makeAiResponse());
    mockResolveProxyAuthHeader.mockReturnValue(undefined);
  });

  it('passes the configured header and the placeholder apiKey to createOpenAI', async () => {
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await runBaseline('plain-key', 'gpt-5.6-sol', makeEvalDef());
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'unused-see-proxy-auth-header',
        headers: { 'x-litellm-api-key': 'Bearer jwt-xyz' },
      }),
    );
  });

  it('passes the plain apiKey and no headers when not configured', async () => {
    mockResolveProxyAuthHeader.mockReturnValue(undefined);
    await runBaseline('plain-key', 'gpt-5.6-sol', makeEvalDef());
    const opts = mockCreateOpenAI.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.apiKey).toBe('plain-key');
    expect(opts).not.toHaveProperty('headers');
  });
});
```

The signature is `runBaseline(apiKey, model, evalDef)` — verified at `packages/evals/src/runners/baseline.ts:21-25`. Match the existing `runBaseline(...)` invocations elsewhere in this test file.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/evals/tests/baseline.test.ts -t 'proxy auth header'`
Expected: FAIL — `headers` absent from the `createOpenAI` options.

- [ ] **Step 3: Implement**

In `packages/evals/src/runners/baseline.ts`, add `resolveProxyAuthHeader` and `PLACEHOLDER_API_KEY` to the `@a0/evals-core` import, then replace the `createOpenAI` call in `llmCall` (lines 68-71):

```typescript
  const openai = createOpenAI({
    apiKey,
    baseURL: proxy.baseUrl,
  });
```

with:

```typescript
  // A proxy that rejects unauthenticated requests rejects the baseline call too,
  // so it carries the same header as the agent runners.
  const proxyAuth = resolveProxyAuthHeader();
  const openai = createOpenAI({
    apiKey: proxyAuth ? PLACEHOLDER_API_KEY : apiKey,
    baseURL: proxy.baseUrl,
    ...(proxyAuth ? { headers: { [proxyAuth.name]: proxyAuth.value } } : {}),
  });
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/evals/tests/baseline.test.ts`
Expected: PASS

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint && npm run format
git add packages/evals/src/runners/baseline.ts packages/evals/tests/baseline.test.ts
git commit -m "feat: send configured auth header from baseline runner"
```

---

### Task 8: Documentation

**Files:**
- Modify: `AGENTS.md` (Settings table; the four runner-details subsections under "Agent runners")
- Modify: `packages/evals/README.md:104` area (the proxy config table)
- Modify: `apps/auth0-evals/.env.example`
- Modify: `docs/ARCHITECTURE.md` (only if a diagram or prose depicts proxy auth)

**Interfaces:**
- Consumes: the final behaviour from Tasks 1-7.
- Produces: nothing.

- [ ] **Step 1: Confirm the full suite is green before documenting**

Run: `npm run build && npm test`
Expected: PASS. Document only what actually works.

- [ ] **Step 2: Update `packages/evals/README.md`**

In the config table containing `| proxy.apiKey | string | No | API key (falls back to LLM_API_KEY env var) |`, add below it:

```markdown
| `proxy.authHeader` | `object` | No | Custom auth header for the proxy: `{ name, valuePrefix?, tokenEnv }`. When set, the token is read from `process.env[tokenEnv]`, sent as `name: valuePrefix + token`, and the provider-native API key var is set to an inert placeholder instead of the real credential. |
```

- [ ] **Step 3: Update `AGENTS.md`**

In the **Settings** table, add a row after the `Base URL` row:

```markdown
| Proxy auth header    | Optional — `proxy.authHeader` in `eval.config.js` |
```

Then add this subsection under "Agent runners", before "### Auto-routing logic":

```markdown
### Proxy auth header

By default every runner authenticates by injecting `LLM_API_KEY` into the
provider's native credential var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, or the Copilot provider's `apiKey`).

When a proxy requires its own header instead, declare it in `eval.config.js`:

```javascript
proxy: {
  baseUrl: PROXY_BASE_URL,
  authHeader: { name: 'x-litellm-api-key', valuePrefix: 'Bearer ', tokenEnv: 'LLM_PROXY_TOKEN' },
}
```

The framework then sends `x-litellm-api-key: Bearer <token>` on every proxy
request — from all four agent runners, the baseline runner, and the LLM judge —
and sets the provider-native key var to the inert placeholder
`unused-see-proxy-auth-header`. The placeholder is required rather than cosmetic:
the Gemini CLI's auth validator rejects a run with an empty `GEMINI_API_KEY`, and
the Claude binary requires one of its credential vars to be set.

Per-runner mechanism:

| Runner | Mechanism |
| --- | --- |
| claude-code | `ANTHROPIC_CUSTOM_HEADERS` env var |
| codex | `[model_providers.llmproxy.env_http_headers]` in `config.toml`, referencing the `LLM_PROXY_AUTH_TOKEN` env var so the token is never written to disk |
| gemini-cli | `GEMINI_CLI_CUSTOM_HEADERS` env var (requires gemini-cli ≥ 0.51) |
| copilot | `ProviderConfig.headers` |

**Sandbox:** the token's env var is app-named, so add it to `sandbox.passthroughEnv`
in `eval.config.js` — otherwise sandboxed runs fail to authenticate while host
runs succeed. If `proxy.authHeader` is set but its `tokenEnv` is unset, the
framework logs a warning naming the variable and falls back to the API-key path.
```

- [ ] **Step 4: Update `apps/auth0-evals/.env.example`**

Append:

```
# Optional: token for a proxy that requires its own auth header rather than the
# provider-native API key. Only used when `proxy.authHeader` is configured in
# eval.config.js; add this var name to `sandbox.passthroughEnv` too, or
# sandboxed runs won't authenticate.
# LLM_PROXY_TOKEN=
```

Leave line 22 (`GEMINI_PROXY_BASE_URL=http://127.0.0.1:9876`) alone — see the "Flagged for the operator" section of the spec. Changing it could break a setup that currently depends on an external shim.

- [ ] **Step 5: Check `docs/ARCHITECTURE.md`**

Run: `grep -n -i "api key\|apiKey\|LLM_API_KEY\|auth" docs/ARCHITECTURE.md`

If any prose or Mermaid diagram describes how runners authenticate to the proxy, update it to mention the optional auth header. If nothing describes proxy auth, leave the file unchanged — a doc that is still accurate needs no edit.

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run format
git add AGENTS.md packages/evals/README.md apps/auth0-evals/.env.example docs/ARCHITECTURE.md
git commit -m "docs: document configurable proxy auth header"
```

---

### Task 9: End-to-end verification

**Files:** none modified — this task only verifies.

**Interfaces:**
- Consumes: everything from Tasks 1-8.

- [ ] **Step 1: Full build and test**

Run: `npm run build && npm test`
Expected: PASS, no skipped suites.

- [ ] **Step 2: Lint and format clean**

Run: `npm run lint && npm run format`
Expected: no errors, no file changes from format (Task 8 already formatted).

- [ ] **Step 3: Grep-verify the token can never be logged**

Run: `grep -rn "proxyAuth.value\|proxyAuth\.value" packages/*/src | grep -i "logger\|console"`
Expected: no output. If any line matches, the token is being logged — fix it before proceeding.

- [ ] **Step 4: Grep-verify every call site is wired**

Run: `grep -rln "resolveProxyAuthHeader" packages/*/src`
Expected exactly these six files plus the resolver itself:
- `packages/evals-core/src/config/proxy-auth.ts`
- `packages/evals-core/src/graders/llm-judge.ts`
- `packages/evals/src/runners/claude-code/agent.ts`
- `packages/evals/src/runners/codex/agent.ts`
- `packages/evals/src/runners/gemini-cli/agent.ts`
- `packages/evals/src/runners/copilot/agent.ts`
- `packages/evals/src/runners/baseline.ts`

- [ ] **Step 5: Confirm the default path is untouched**

Run: `git diff main --stat`

Review the diff and confirm every behaviour change is gated behind `if (proxyAuth)` or an equivalent. A deployment that does not set `proxy.authHeader` must be unaffected.

- [ ] **Step 6: Report**

Report to the user: which tasks landed, the full test output, and the fact that no live proxy was exercised — every test uses mocks, so the header format is verified against the SDK sources cited in the spec but not against a real gateway. Recommend a single real run (`npm run evals -- --eval react_quickstart --mode baseline`) against the target proxy as the final confirmation, since that is the cheapest path that exercises a real request.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Config surface (`ProxyAuthHeaderConfig`, `authHeader`) | Task 1 Step 1 |
| Resolver (`resolveProxyAuthHeader`, `PLACEHOLDER_API_KEY`) | Task 1 Steps 4-5 |
| claude-code call site | Task 3 |
| codex call site (`env_http_headers`, fixed env var) | Task 6 |
| gemini-cli call site | Task 4 |
| copilot call site | Task 5 |
| baseline call site | Task 7 |
| llm-judge call site (drops `Authorization`) | Task 2 |
| Sandbox (`passthroughEnv`, docs-only) | Task 8 Steps 3-4 |
| Testing (resolver + per-runner + regression) | Tasks 1-7, each with a not-configured regression test |
| Documentation | Task 8 |
| Flagged `.env.example:22` — deliberately unchanged | Task 8 Step 4 |

No spec requirement is unaddressed.

**Type consistency:** `resolveProxyAuthHeader()` returns `ResolvedProxyAuth | undefined` with fields `name`/`value`/`tokenEnv` in Task 1, and every consumer (Tasks 2-7) reads exactly those three names. `PLACEHOLDER_API_KEY` is the literal `'unused-see-proxy-auth-header'` in Task 1 and every test asserts that exact string. `CODEX_PROXY_AUTH_TOKEN_ENV` is `'LLM_PROXY_AUTH_TOKEN'` in Task 6 and the Task 6 test asserts that name. `writeCodexConfig` gains a sixth parameter `proxyAuthHeaderName?: string` and its single call site is updated in the same task.

**Note on test-file mocking:** Tasks 3-7 each add `resolveProxyAuthHeader` to an existing `@a0/evals-core` mock. The four runner test files mock that module differently (some spread `vi.importActual`, some return a literal). Each task says to inspect the existing factory before editing rather than assuming a shape — the alternative, prescribing one shape, would be wrong in at least one file.
