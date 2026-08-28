/**
 * Unit tests for writeOpencodeConfig in opencode/agent.ts.
 *
 * Writes to a real temp directory and reads the generated opencode.jsonc back
 * to assert on its structure, matching the pattern used by other config-writer
 * tests in this suite.
 *
 * Critical correctness assertions:
 *   1. Provider uses @ai-sdk/openai-compatible; baseURL ends with /v1; apiKey is {env:LLM_API_KEY}
 *   2. model AND small_model are BOTH '<OPENCODE_PROVIDER_NAME>/llama-4-maverick-17b'
 *      (the #1 opencode correctness trap — small_model must be pinned to the same model)
 *   3. Authed MCP server → type: 'remote', headers.Authorization with {env:VAR} placeholder,
 *      bearerTokens map carries the minted token under that VAR
 *   4. NO raw secret in the written file
 *   5. Without tools:['mcp'], no mcp key in config
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Mock framework config and token helpers ───────────────────────────────────

const mockGetFrameworkConfig = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    proxy: { baseUrl: 'https://llm.example.com' },
    mcp: {
      servers: {
        'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
        'auth0-hosted-mcp': {
          type: 'http',
          url: 'https://tenant.auth0.com/v1/mcp',
          auth: {
            tokenUrl: 'https://tenant.auth0.com/oauth/token',
            clientId: 'cid',
            clientSecret: 'secret',
            audience: 'https://tenant.auth0.com/api/v2/',
          },
        },
      },
    },
  }),
);

const mintMcpTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@a0/evals-core', async () => ({
  ...(await vi.importActual('@a0/evals-core')),
  getFrameworkConfig: mockGetFrameworkConfig,
  mintMcpToken: mintMcpTokenMock,
  getAgentProxyBaseUrl: vi.fn().mockReturnValue('https://llm.example.com'),
  filteredEnv: vi.fn().mockReturnValue({}),
  makeSessionId: vi.fn().mockReturnValue('test-session-id'),
  estimateCost: vi.fn().mockReturnValue(0),
}));

import {
  writeOpencodeConfig,
  OPENCODE_PROVIDER_NAME,
  OPENCODE_DEFAULT_MODEL,
} from '../../src/runners/opencode/agent.js';

// ── Temp workspace helpers ────────────────────────────────────────────────────

let tmpWorkspace: string;

beforeEach(() => {
  mintMcpTokenMock.mockReset();
  tmpWorkspace = mkdtempSync(join(tmpdir(), 'opencode-config-'));
});

afterEach(() => {
  rmSync(tmpWorkspace, { recursive: true, force: true });
});

function readConfig(): Record<string, unknown> {
  const raw = readFileSync(join(tmpWorkspace, 'opencode.jsonc'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function readConfigRaw(): string {
  return readFileSync(join(tmpWorkspace, 'opencode.jsonc'), 'utf-8');
}

// ── provider block ────────────────────────────────────────────────────────────

describe('provider block', () => {
  it('uses @ai-sdk/openai-compatible as the npm package', async () => {
    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    const config = readConfig();
    const provider = (config.provider as Record<string, unknown>)[OPENCODE_PROVIDER_NAME] as Record<string, unknown>;
    expect(provider.npm).toBe('@ai-sdk/openai-compatible');
  });

  it('options.baseURL ends with /v1', async () => {
    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    const config = readConfig();
    const provider = (config.provider as Record<string, unknown>)[OPENCODE_PROVIDER_NAME] as Record<string, unknown>;
    const options = provider.options as Record<string, unknown>;
    expect(typeof options.baseURL).toBe('string');
    expect((options.baseURL as string).endsWith('/v1')).toBe(true);
  });

  it('options.apiKey is the {env:LLM_API_KEY} placeholder, never a raw key', async () => {
    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    const config = readConfig();
    const provider = (config.provider as Record<string, unknown>)[OPENCODE_PROVIDER_NAME] as Record<string, unknown>;
    const options = provider.options as Record<string, unknown>;
    expect(options.apiKey).toBe('{env:LLM_API_KEY}');
  });

  it('does not double-append /v1 when proxy URL already ends with /v1', async () => {
    // The mock already returns 'https://llm.example.com' (no /v1).
    // Test that a URL already containing /v1 doesn't become /v1/v1.
    const { getAgentProxyBaseUrl } = await import('@a0/evals-core');
    vi.mocked(getAgentProxyBaseUrl).mockReturnValueOnce('https://llm.example.com/v1');

    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    const config = readConfig();
    const provider = (config.provider as Record<string, unknown>)[OPENCODE_PROVIDER_NAME] as Record<string, unknown>;
    const options = provider.options as Record<string, unknown>;
    expect(options.baseURL).toBe('https://llm.example.com/v1');
    expect((options.baseURL as string).endsWith('/v1/v1')).toBe(false);
  });
});

// ── model and small_model pinning ─────────────────────────────────────────────

describe('model and small_model — BOTH must be pinned to the same model (critical correctness trap)', () => {
  it('model AND small_model are BOTH set to "<OPENCODE_PROVIDER_NAME>/llama-4-maverick-17b"', async () => {
    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    const config = readConfig();

    const expectedModelRef = `${OPENCODE_PROVIDER_NAME}/${OPENCODE_DEFAULT_MODEL}`;
    expect(config.model).toBe(expectedModelRef);
    // This is the critical assertion: small_model must be pinned to the same value.
    // If small_model is missing or different, opencode's compaction/title calls
    // will use a built-in model ID that the proxy will 400 on.
    expect(config.small_model).toBe(expectedModelRef);
    expect(config.model).toBe(config.small_model);
  });

  it('model AND small_model are BOTH updated when a custom model is passed', async () => {
    const customModel = 'llama-3-70b';
    await writeOpencodeConfig(tmpWorkspace, customModel, { tools: [] });
    const config = readConfig();

    const expectedModelRef = `${OPENCODE_PROVIDER_NAME}/${customModel}`;
    expect(config.model).toBe(expectedModelRef);
    expect(config.small_model).toBe(expectedModelRef);
  });
});

// ── MCP servers: with tools:['mcp'] ──────────────────────────────────────────

describe('MCP config — with tools: ["mcp"]', () => {
  it('authed server appears as type:remote with {env:VAR} Authorization header', async () => {
    mintMcpTokenMock.mockResolvedValueOnce('minted-token-xyz');

    const result = await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: ['mcp'] });
    const config = readConfig();
    const mcpServers = config.mcp as Record<string, Record<string, unknown>>;

    expect(mcpServers).toBeDefined();
    const authedServer = mcpServers['auth0-hosted-mcp'];
    expect(authedServer).toBeDefined();
    expect(authedServer.type).toBe('remote');
    const headers = authedServer.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer \{env:MCP_BEARER_/);
    expect(headers.Authorization).not.toContain('minted-token-xyz');

    // Extract the env var name from the placeholder
    const envVarMatch = /\{env:([^}]+)\}/.exec(headers.Authorization);
    expect(envVarMatch).not.toBeNull();
    const envVar = envVarMatch![1];

    // bearerTokens carries the minted token under that env var name
    expect(result.bearerTokens[envVar]).toBe('minted-token-xyz');
  });

  it('unauthed server appears as type:remote without Authorization header', async () => {
    mintMcpTokenMock.mockResolvedValueOnce('minted-token-xyz');

    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: ['mcp'] });
    const config = readConfig();
    const mcpServers = config.mcp as Record<string, Record<string, unknown>>;

    const unauthedServer = mcpServers['auth0-docs'];
    expect(unauthedServer).toBeDefined();
    expect(unauthedServer.type).toBe('remote');
    expect(unauthedServer.headers).toBeUndefined();
  });

  it('NO raw secret in the written file — only {env:...} placeholders', async () => {
    const rawToken = 'super-secret-bearer-token-12345';
    mintMcpTokenMock.mockResolvedValueOnce(rawToken);

    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: ['mcp'] });
    const fileText = readConfigRaw();

    // Raw token must never appear in the config file
    expect(fileText).not.toContain(rawToken);
    // apiKey must not contain a raw key
    expect(fileText).not.toContain('process.env');
    // But the {env:...} placeholder must be there
    expect(fileText).toContain('{env:LLM_API_KEY}');
    expect(fileText).toContain('{env:MCP_BEARER_');
  });

  it('returns mcpServerNames for registered servers', async () => {
    mintMcpTokenMock.mockResolvedValueOnce('tok');

    const result = await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: ['mcp'] });
    expect(result.mcpServerNames).toContain('auth0-hosted-mcp');
    expect(result.mcpServerNames).toContain('auth0-docs');
  });

  it('skips an authed server when the token mint fails (returns undefined)', async () => {
    // mintMcpToken returns undefined → server is skipped, not registered
    mintMcpTokenMock.mockResolvedValueOnce(undefined);
    // auth0-docs is unauthed and always registers; auth0-hosted-mcp is authed and skipped

    const result = await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: ['mcp'] });
    const config = readConfig();
    const mcpServers = (config.mcp ?? {}) as Record<string, unknown>;

    // auth0-hosted-mcp must not appear in the config
    expect(mcpServers['auth0-hosted-mcp']).toBeUndefined();
    // auth0-docs (unauthed) still appears
    expect(mcpServers['auth0-docs']).toBeDefined();
    // bearerTokens should be empty since no token was minted
    expect(Object.keys(result.bearerTokens)).toHaveLength(0);
  });
});

// ── MCP config: without tools:['mcp'] ────────────────────────────────────────

describe('MCP config — without tools: ["mcp"]', () => {
  it('no mcp key (or empty) when tools does not include mcp', async () => {
    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    const config = readConfig();

    // Either mcp key is absent or it is an empty object
    if ('mcp' in config) {
      const mcpServers = config.mcp as Record<string, unknown>;
      expect(Object.keys(mcpServers)).toHaveLength(0);
    } else {
      expect(config.mcp).toBeUndefined();
    }

    // bearerTokens should be empty
    const result = await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    expect(Object.keys(result.bearerTokens)).toHaveLength(0);
  });

  it('mintMcpToken is never called when tools does not include mcp', async () => {
    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    expect(mintMcpTokenMock).not.toHaveBeenCalled();
  });
});

// ── config file is valid JSON ─────────────────────────────────────────────────

describe('config file structure', () => {
  it('writes a valid JSON file (JSONC subset — no comments in generated output)', async () => {
    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    // If JSON.parse throws, the test fails — that's the assertion.
    expect(() => readConfig()).not.toThrow();
  });

  it('includes the $schema field', async () => {
    await writeOpencodeConfig(tmpWorkspace, OPENCODE_DEFAULT_MODEL, { tools: [] });
    const config = readConfig();
    expect(config.$schema).toBe('https://opencode.ai/config.json');
  });
});
