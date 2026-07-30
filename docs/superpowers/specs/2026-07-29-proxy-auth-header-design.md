# Configurable proxy auth header

**Date:** 2026-07-29
**Status:** Approved

## Problem

Every LLM call in this framework authenticates by injecting a single env var,
`LLM_API_KEY`, into whatever auth mechanism each provider natively expects:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or a `provider.apiKey`
field. That works against a proxy that accepts the provider's own credential
header.

It does not work against a proxy that requires its own header. The sibling
`agent-skills-activation` harness fronts LiteLLM, which authenticates on
`x-litellm-api-key: Bearer <jwt>` — a header this framework has no way to send.

We need the auth header to be configurable per deployment, so the same framework
runs against LiteLLM, the Bedrock proxy, or a future gateway without code
changes.

## Scope

**In scope:** a configurable auth header name and value format, sourced from a
static token in an env var, applied at all six places the framework talks to the
proxy.

**Out of scope:** minting tokens via OAuth client-credentials (the framework
already does this for MCP servers in `packages/evals-core/src/config/mcp-auth.ts`;
extending it to the proxy is a separate change), and per-model or per-runner
distinct credentials.

## Grounding

Every mechanism below was verified against the SDK versions pinned in
`packages/evals/package.json`, not from documentation or memory.

| Runner | Mechanism | Verified at |
| --- | --- | --- |
| claude-code | `ANTHROPIC_CUSTOM_HEADERS` env var, newline-separated `Name: Value` pairs | `@anthropic-ai/claude-agent-sdk/bridge.mjs:90` — parses the var, splits on `\n`, splits each line at the first `:`, and merges into `defaultHeaders` |
| codex | `http_headers` / `env_http_headers` on the model provider | `ModelProviderInfo` (17 fields, both keys present) in `@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex` |
| copilot | `ProviderConfig.headers` | `@github/copilot-sdk/dist/generated/rpc.d.ts:7281` — "Custom HTTP headers to include in all outbound requests to the provider" |
| gemini-cli | `GEMINI_CLI_CUSTOM_HEADERS` env var, comma-separated `Name: Value` pairs | `@google/gemini-cli/bundle/chunk-BVT2OZGG.js:303158` reads the var; `:303182-303187` parses it via `parseCustomHeaders` and spreads it into the headers sent to the model endpoint; `:302939` defines the format (split on `/,(?=\s*[^,:]+:)/`, then at the first `:`) |

Two findings shaped the design and reversed earlier assumptions:

**The Gemini reverse-proxy shim is unnecessary.** `agent-skills-activation`
carries `src/gemini-proxy-shim.ts` (~110 lines plus tests) purely because the
Gemini CLI could not send a custom header. Version 0.51 — the version pinned
here as `^0.51.0` — supports `GEMINI_CLI_CUSTOM_HEADERS` natively. Porting the
shim would add a per-job subprocess, an ephemeral port, and a hop that masks
upstream errors as 502s, all to replace one env var. We use the env var.

**The native key var cannot simply be dropped.** Two runners hard-require it:

- Gemini CLI's `validateAuthMethod` (`bundle/chunk-KY6QUHBP.js:60830`) returns
  the error _"When using Gemini API, you must specify the GEMINI_API_KEY
  environment variable"_ whenever `authType === 'gemini-api-key'`. Our runner
  pins exactly that auth type (`gemini-cli/agent.ts:57`), because the newer
  `gateway` type has no case in the non-interactive validator and fails the run.
- The Claude binary requires one of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN`, or the WIF pair
  (`ANTHROPIC_FEDERATION_RULE_ID` + `ANTHROPIC_ORGANIZATION_ID`).

So when an auth header is configured, the native key var is set to an inert
placeholder rather than the real token. Validators pass, and the token is never
sent in a provider-native header where a misconfigured proxy might honour it.

## Design

### Config surface

`ProxyConfig` in `packages/evals-core/src/config/framework.ts` gains one
optional field:

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
  baseUrl: string;
  apiKey?: string;
  /** When set, the framework sends this header on every proxy request. */
  authHeader?: ProxyAuthHeaderConfig;
}
```

Consumers declare it in `eval.config.js`:

```javascript
proxy: {
  baseUrl: PROXY_BASE_URL,
  authHeader: {
    name: 'x-litellm-api-key',
    valuePrefix: 'Bearer ',
    tokenEnv: 'LLM_PROXY_TOKEN',
  },
}
```

The header name and prefix are independent, so `Authorization: Bearer <jwt>`,
`x-litellm-api-key: Bearer <jwt>`, and a bare `x-api-key: <jwt>` (empty prefix)
are all expressible. The token lives in an env var named by the app, never in
config.

When `authHeader` is absent the framework behaves exactly as it does today. This
is the default, and it is what keeps every existing deployment working.

### Resolver

A new module, `packages/evals-core/src/config/proxy-auth.ts`, is the single place
the header is composed. It exports one pure-ish function and one constant:

```typescript
export interface ResolvedProxyAuth {
  /** Header name, verbatim from config. */
  name: string;
  /** Composed value: valuePrefix + token. */
  value: string;
  /** Env var the token came from — used by codex's env_http_headers. */
  tokenEnv: string;
}

export function resolveProxyAuthHeader(): ResolvedProxyAuth | undefined;

export const PLACEHOLDER_API_KEY = 'unused-see-proxy-auth-header';
```

Behaviour, in order:

- `proxy.authHeader` absent → returns `undefined`. Callers fall back to today's
  `LLM_API_KEY` path.
- **`LLM_API_KEY` set → returns `undefined`, even with a valid `authHeader`.** The
  provider-native key always wins, so a deployment that still exports it keeps its
  current behaviour untouched and adopting the header is an explicit act: unset
  `LLM_API_KEY`. Logs one `logger.info` naming the variable so the ignored
  `authHeader` is never silent.
- Configured, `LLM_API_KEY` unset, and `process.env[tokenEnv]` non-empty → returns
  the resolved header.
- Configured but the env var is missing or empty → logs one
  `logger.warn('[proxy-auth] ...')` naming the env var, and returns `undefined`.
  A forgotten `export` then surfaces at startup instead of as an opaque 401 mid-run.
  This matches how `mintMcpToken` reports a failed mint.

Because `LLM_API_KEY` gates the header, `validateApiKey()` in
`packages/evals/src/cli/validators.ts` can no longer hard-exit when it is unset —
that would leave the header path unreachable (set → legacy wins; unset → exit).
It returns `''` when `authHeader` is configured, and call sites write
`PLACEHOLDER_API_KEY` into provider-native key fields as before.

The function never logs the token value. `ResolvedProxyAuth.value` carries the
secret and must not be passed to `logger`; call sites log the header *name* only.

`PLACEHOLDER_API_KEY` is the inert value written to provider-native key vars when
an auth header is configured. Its text is deliberately self-explanatory, so it
reads as an intentional placeholder if it ever appears in a proxy error message.

### Call sites

Six places talk to the proxy. Each gains the header when
`resolveProxyAuthHeader()` returns a value, and is untouched otherwise.

| Site | Change |
| --- | --- |
| `packages/evals/src/runners/claude-code/agent.ts:124` | Set `proxyEnv.ANTHROPIC_CUSTOM_HEADERS = \`${name}: ${value}\``; set `ANTHROPIC_API_KEY` to `PLACEHOLDER_API_KEY` |
| `packages/evals/src/runners/codex/agent.ts:100` (`writeCodexConfig`) | Emit an `[model_providers.llmproxy.env_http_headers]` table mapping the header name to the env var name; inject the token into the subprocess env under that name; set `OPENAI_API_KEY` to `PLACEHOLDER_API_KEY` |
| `packages/evals/src/runners/gemini-cli/agent.ts:240` | Set `GEMINI_CLI_CUSTOM_HEADERS = \`${name}: ${value}\``; set `GEMINI_API_KEY` to `PLACEHOLDER_API_KEY` |
| `packages/evals/src/runners/copilot/agent.ts:187` | Add `headers: { [name]: value }` to the `ProviderConfig`; set `apiKey` to `PLACEHOLDER_API_KEY` |
| `packages/evals/src/runners/baseline.ts:68` | Add `headers: { [name]: value }` to `createOpenAI({ ... })` — verified as `OpenAIProviderSettings.headers` at `@ai-sdk/openai/dist/index.d.ts:1226`; set `apiKey` to `PLACEHOLDER_API_KEY` |
| `packages/evals-core/src/graders/llm-judge.ts:81` | Add the header to the `fetch` headers object alongside `Content-Type`, and drop the `Authorization: Bearer ${apiKey}` line |

The last two follow the same replace-not-augment rule as the runners: when an
auth header is configured, the credential travels in that header alone. The judge
drops its `Authorization` header entirely rather than sending a placeholder,
because unlike the CLI runners it has no validator demanding the field be present.

Both the single-shot baseline path and the judge are included deliberately. A
proxy that rejects unauthenticated requests rejects all of them — a design that
covered only the agent runners would leave baseline runs and every `judge()`
grader failing.

Codex is the one asymmetric case, and the asymmetry is the point:
`env_http_headers` maps a header name to an *env var name*, so the token stays
out of `config.toml` on disk. This reuses the pattern already established for
authenticated MCP servers, which reference `bearer_token_env_var` for the same
reason.

Inside the codex subprocess the token is injected under the fixed name
`LLM_PROXY_AUTH_TOKEN`, not under the app's `tokenEnv` name. The generated
`env_http_headers` table references that fixed name. Decoupling the two means an
app is free to choose any `tokenEnv` without the value having to survive
`filteredEnv()` — which strips everything outside its allowlist — and without an
app-chosen name colliding with a codex config key.

Header value composition (`valuePrefix + token`) happens once, in the resolver.
No call site concatenates the prefix itself.

### Sandbox

`packages/evals/src/sandbox/docker.ts:148` forwards `LLM_API_KEY` into the
container explicitly, because the framework owns that name. The proxy token's env
var is named by the app, so it rides the existing `sandbox.passthroughEnv`
mechanism: the app adds its `tokenEnv` value to that array in `eval.config.js`,
exactly as it already does for `MCP_CLIENT_SECRET`. Forwarding logs names only,
never values.

No framework change is needed here. The requirement is a documentation one: an
app that configures `proxy.authHeader` and forgets to add its `tokenEnv` to
`passthroughEnv` gets sandboxed runs that fail to authenticate while host runs
succeed. The existing "Passthrough env not set on host (skipped)" warning covers
the inverse case only, so the docs must call this out.

### Testing

Per repo convention, tests live in the package where the changed code lives.

`packages/evals-core/tests/config/proxy-auth.test.ts`:

- unconfigured → `undefined`
- configured with a non-empty token → composed `name`/`value`/`tokenEnv`
- configured with a missing token → `undefined`, and a warning was logged
- configured with an empty-string token → `undefined` (empty is not a credential)
- `valuePrefix` omitted → value is the bare token, no leading space

Runner tests extend the existing per-runner files, using
`packages/evals/tests/runners/gemini-cli-proxy.test.ts` as the template — it
already stubs `process.env` and captures the env passed to `spawn`. For each of
the four runners:

- header present with the composed value when configured
- header absent when not configured
- native key var equals `PLACEHOLDER_API_KEY` when configured
- native key var equals `LLM_API_KEY` when not configured (regression guard on
  the default path)

Codex additionally asserts that the generated `config.toml` contains an
`env_http_headers` entry and does **not** contain the token value.

Baseline and judge tests assert the header reaches the outbound request —
`createOpenAI` accepts a `fetch` override, and the judge calls global `fetch`, so
both are capturable without a live proxy.

### Documentation

| Doc | Update |
| --- | --- |
| `AGENTS.md` | Settings table gains the auth-header row; the four runner-details sections describe their header mechanism |
| `packages/evals/README.md` | Config table gains `proxy.authHeader` |
| `apps/auth0-evals/.env.example` | Add the token var with a comment; see the note below |
| `docs/ARCHITECTURE.md` | Update only if a diagram depicts proxy auth |

## The `127.0.0.1:9876` loopback proxy — keep it

**Corrected after implementation.** An earlier draft of this spec assumed the
loopback port in `GEMINI_PROXY_BASE_URL=http://127.0.0.1:9876` was a
header-injecting shim made obsolete by `GEMINI_CLI_CUSTOM_HEADERS`, and flagged it
for removal. That was wrong, and acting on it breaks Gemini runs.

The process on that port is `scripts/gemini-sse-proxy.js` in the
`auth0-evals-runner` repo, and its own header says what it does:

> Works around a LiteLLM proxy bug (v1.86.0+) where `streamGenerateContent`
> responses are double-wrapped in SSE format. This proxy reassembles the
> fragmented payload and forwards clean events.

It has nothing to do with authentication — it forwards headers verbatim
(`{ ...req.headers }`) and exists purely to unwrap doubly-wrapped SSE. CI starts
it explicitly for `gemini-cli` jobs before running the eval.

Consequences, verified by running it both ways:

- With the loopback proxy bypassed, Gemini fails with
  `TypeError: fetch failed sending request` after nine retries — the LiteLLM
  streaming bug, not an auth error.
- With it running, the same eval passes (`grade=A (94)`), and the auth header
  reaches LiteLLM through it unchanged.

So `GEMINI_PROXY_BASE_URL` should keep pointing at the loopback proxy, and the
SSE workaround stays until the upstream LiteLLM bug is fixed. The two concerns are
orthogonal: this spec changes how the credential is *carried*, not how the
response stream is *decoded*.

## Consequences

- Apps that set nothing new keep working; the header path is entirely opt-in.
- Gemini CLI support now depends on a 0.51 feature. `package.json` pins
  `^0.51.0`, so a downgrade below that would silently drop the header. The
  gemini runner test asserting the env var is present is what catches this.
- The token is visible in the environment of spawned runner subprocesses — the
  same exposure `LLM_API_KEY` already has. Keeping it out of on-disk config
  (codex) is the meaningful hardening; env-var exposure is inherent to driving
  CLI agents as subprocesses.
