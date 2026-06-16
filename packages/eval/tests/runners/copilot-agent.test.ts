/**
 * Unit tests for the Copilot SDK agent runner.
 *
 * Tests the exported helpers/constants directly, and tests runCopilotAgent
 * by mocking @github/copilot-sdk so we can drive controlled event sequences
 * through the session and verify RunRecord fields are populated correctly.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock only mintMcpToken so authed-server tests don't perform a real OAuth fetch.
const mintMcpTokenMock = vi.hoisted(() => vi.fn());
vi.mock('@a0/eval-core', async () => ({
  ...(await vi.importActual('@a0/eval-core')),
  mintMcpToken: mintMcpTokenMock,
}));

import { setFrameworkConfig } from '@a0/eval-core';
import { TEST_CONFIG } from '../test-config.js';

beforeAll(() => {
  setFrameworkConfig(TEST_CONFIG);
});

// ── Mock @github/copilot-sdk ──────────────────────────────────────────────────

/**
 * Fake session that captures event handlers registered via `on()` and lets
 * tests fire events into them. `sendAndWait` runs a user-supplied scenario
 * function that fires events, then resolves.
 */
class FakeSession extends EventEmitter {
  sessionId = 'fake-session-id';
  private _scenario: ((session: FakeSession) => Promise<void>) | undefined;
  abort = vi.fn().mockResolvedValue(undefined);
  disconnect = vi.fn().mockResolvedValue(undefined);

  /**
   * Subscribe to typed events — mirrors the CopilotSession.on() signature
   * which returns an unsubscribe function. We use the EventEmitter internally
   * but expose the SDK's return type via a separate method name to avoid
   * conflicting with EventEmitter.on()'s `this` return type.
   */
  subscribe(eventType: string, handler: (...args: unknown[]) => void): () => void {
    super.on(eventType, handler);
    return () => super.off(eventType, handler);
  }

  /** Alias used by the production code — delegates to subscribe. */
  override on(eventType: string, handler: (...args: unknown[]) => void): this {
    this.subscribe(eventType, handler);
    return this;
  }

  /** Set the scenario that sendAndWait will execute. */
  setScenario(fn: (session: FakeSession) => Promise<void>) {
    this._scenario = fn;
  }

  /** Fire a typed event into the registered handlers. */
  fire(type: string, data: Record<string, unknown>, timestamp?: string) {
    this.emit(type, { type, data, timestamp: timestamp ?? new Date().toISOString() });
  }

  async sendAndWait(): Promise<{ data: { content: string } } | undefined> {
    if (this._scenario) await this._scenario(this);
    return undefined;
  }
}

let fakeSession: FakeSession;
const mockCreateSession = vi.fn();
const mockClientStop = vi.fn().mockResolvedValue([]);

vi.mock('@github/copilot-sdk', () => {
  return {
    CopilotClient: class MockCopilotClient {
      createSession(...args: unknown[]) {
        return mockCreateSession(...args);
      }
      stop() {
        return mockClientStop();
      }
    },
    approveAll: vi.fn(),
  };
});

// Must import after vi.mock
import { MAX_TURNS } from '@a0/eval-core';
import {
  runCopilotAgent,
  COPILOT_MODEL_ID,
  COPILOT_DEFAULT_MODEL,
  getMcpServers,
} from '../../src/runners/copilot/agent.js';
import { CopilotCliTranslator } from '../../src/runners/copilot/translator.js';
import { CopilotCliRunner } from '../../src/runners/copilot/runner.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const evalDef = { id: 'test_eval', userPrompt: 'Integrate Auth0 into a React app' };
const workspace = '/tmp/test-workspace';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  fakeSession = new FakeSession();
  mockCreateSession.mockResolvedValue(fakeSession);
  mockClientStop.mockResolvedValue([]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers / constants ───────────────────────────────────────────────────────

describe('COPILOT_MODEL_ID', () => {
  it('is the expected sentinel value', () => {
    expect(COPILOT_MODEL_ID).toBe('copilot');
  });
});

describe('COPILOT_DEFAULT_MODEL', () => {
  it('is gpt-5.4', () => {
    expect(COPILOT_DEFAULT_MODEL).toBe('gpt-5.4');
  });
});

describe('getMcpServers', () => {
  it('returns auth0-docs remote MCP server config', async () => {
    const servers = await getMcpServers();
    expect(servers).toHaveProperty('auth0-docs');
    expect(servers['auth0-docs'].type).toBe('http');
    expect((servers['auth0-docs'] as { url: string }).url).toBe('https://auth0.com/docs/mcp');
  });

  it('includes all tools via wildcard', async () => {
    const servers = await getMcpServers();
    expect((servers['auth0-docs'] as { tools: string[] }).tools).toContain('*');
  });

  it('does not set an Authorization header for unauthenticated servers', async () => {
    const servers = await getMcpServers();
    expect((servers['auth0-docs'] as { headers?: Record<string, string> }).headers).toBeUndefined();
  });

  it('mints a token and forwards it as an Authorization header for authed servers', async () => {
    mintMcpTokenMock.mockResolvedValueOnce('minted-token');
    setFrameworkConfig({
      ...TEST_CONFIG,
      mcp: {
        servers: {
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
    });
    const servers = await getMcpServers();
    expect((servers['auth0-hosted-mcp'] as { headers?: Record<string, string> }).headers).toEqual({
      Authorization: 'Bearer minted-token',
    });
    setFrameworkConfig(TEST_CONFIG);
  });

  it('skips an authed server when the token mint fails', async () => {
    mintMcpTokenMock.mockResolvedValueOnce(undefined);
    setFrameworkConfig({
      ...TEST_CONFIG,
      mcp: {
        servers: {
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
    });
    const servers = await getMcpServers();
    expect(servers).not.toHaveProperty('auth0-hosted-mcp');
    setFrameworkConfig(TEST_CONFIG);
  });
});

// ── CopilotCliTranslator ──────────────────────────────────────────────────────

describe('CopilotCliTranslator', () => {
  const translator = new CopilotCliTranslator();

  it.each([
    ['bash', 'run_command'],
    ['read_bash', 'run_command'],
    ['view', 'read_file'],
    ['read', 'read_file'],
    ['write', 'write_file'],
    ['create', 'write_file'],
    ['edit', 'write_file'],
    ['apply_patch', 'write_file'],
    ['glob', 'list_files'],
    ['grep', 'list_files'],
    ['web_fetch', 'fetch_url'],
    ['web_search', 'fetch_url'],
    ['ask_user', 'ask_user'],
  ])('maps %s -> %s', (copilotName, expected) => {
    expect(translator.mapName(copilotName)).toBe(expected);
  });

  it('normalizes MCP tool names to the mcp__ prefix (legacy preserved, hyphen prefixed)', () => {
    expect(translator.mapName('mcp__auth0-docs__search_auth0_docs')).toBe('mcp__auth0-docs__search_auth0_docs');
    expect(translator.mapName('auth0-docs-search_auth0_docs')).toBe('mcp__auth0-docs-search_auth0_docs');
  });

  it('does not map prototype keys from Object inheritance chain', () => {
    expect(translator.mapName('toString')).toBe('tostring');
    expect(translator.mapName('constructor')).toBe('constructor');
  });

  it('classifies doc lookups for web and mcp tools', () => {
    expect(translator.isDocLookup('web_fetch')).toBe(true);
    expect(translator.isDocLookup('web_search')).toBe(true);
    expect(translator.isDocLookup('auth0-docs-search_auth0_docs')).toBe(true);
    expect(translator.isDocLookup('bash')).toBe(false);
  });

  it('classifies interruptions and internal tools', () => {
    expect(translator.isInterruption('ask_user')).toBe(true);
    expect(translator.isInterruption('view')).toBe(false);
    expect(translator.isInternalTool('report_intent')).toBe(true);
    expect(translator.isInternalTool('skill')).toBe(true);
    expect(translator.isInternalTool('view')).toBe(false);
  });
});

// ── CopilotCliTranslator.normalizeArgs ────────────────────────────────────────

describe('CopilotCliTranslator — normalizeArgs', () => {
  const translator = new CopilotCliTranslator();

  it('bash: extracts command', () => {
    expect(translator.normalizeArgs('bash', { command: 'npm test' })).toEqual({ command: 'npm test' });
  });

  it('bash: falls back to cmd', () => {
    expect(translator.normalizeArgs('bash', { cmd: 'ls' })).toEqual({ command: 'ls' });
  });

  it('read_bash: extracts command', () => {
    expect(translator.normalizeArgs('read_bash', { command: 'cat foo' })).toEqual({ command: 'cat foo' });
  });

  it('view: extracts path', () => {
    expect(translator.normalizeArgs('view', { path: 'src/index.ts' })).toEqual({ path: 'src/index.ts' });
  });

  it('view: falls back to file_path', () => {
    expect(translator.normalizeArgs('view', { file_path: 'app.ts' })).toEqual({ path: 'app.ts' });
  });

  it('read: extracts path', () => {
    expect(translator.normalizeArgs('read', { path: 'src/main.ts' })).toEqual({ path: 'src/main.ts' });
  });

  it('write: extracts path and content', () => {
    expect(translator.normalizeArgs('write', { path: 'out.txt', content: 'hello' })).toEqual({
      path: 'out.txt',
      content: 'hello',
    });
  });

  it('write: falls back to file_path and new_str', () => {
    expect(translator.normalizeArgs('write', { file_path: 'out.txt', new_str: 'hello' })).toEqual({
      path: 'out.txt',
      content: 'hello',
    });
  });

  it('create: extracts path and content', () => {
    expect(translator.normalizeArgs('create', { path: 'new.ts', content: 'code' })).toEqual({
      path: 'new.ts',
      content: 'code',
    });
  });

  it('edit: extracts path and content', () => {
    expect(translator.normalizeArgs('edit', { path: 'app.ts', content: 'updated' })).toEqual({
      path: 'app.ts',
      content: 'updated',
    });
  });

  it('apply_patch: extracts path and content', () => {
    expect(translator.normalizeArgs('apply_patch', { path: 'f.ts', content: 'diff' })).toEqual({
      path: 'f.ts',
      content: 'diff',
    });
  });

  it('glob: maps pattern to path', () => {
    expect(translator.normalizeArgs('glob', { pattern: '**/*.ts' })).toEqual({ path: '**/*.ts' });
  });

  it('glob: falls back to path', () => {
    expect(translator.normalizeArgs('glob', { path: 'src' })).toEqual({ path: 'src' });
  });

  it('grep: maps pattern to path', () => {
    expect(translator.normalizeArgs('grep', { pattern: 'import' })).toEqual({ path: 'import' });
  });

  it('web_fetch: extracts url', () => {
    expect(translator.normalizeArgs('web_fetch', { url: 'https://auth0.com' })).toEqual({
      url: 'https://auth0.com',
    });
  });

  it('web_search: maps query to url', () => {
    expect(translator.normalizeArgs('web_search', { query: 'auth0 login' })).toEqual({ url: 'auth0 login' });
  });

  it('ask_user: extracts question', () => {
    expect(translator.normalizeArgs('ask_user', { question: 'Which tenant?' })).toEqual({
      question: 'Which tenant?',
    });
  });

  it('unknown tool returns input unchanged', () => {
    const input = { custom: 'arg', value: 42 };
    expect(translator.normalizeArgs('future_tool', input)).toEqual(input);
  });

  it('normalizes case-insensitively', () => {
    expect(translator.normalizeArgs('BASH', { command: 'echo hi' })).toEqual({ command: 'echo hi' });
    expect(translator.normalizeArgs('View', { path: 'x.ts' })).toEqual({ path: 'x.ts' });
  });
});

// ── runCopilotAgent ───────────────────────────────────────────────────────────

describe('runCopilotAgent', () => {
  it('successful run with tool calls populates record correctly', async () => {
    fakeSession.setScenario(async (s) => {
      // Turn 1: assistant message with a tool request
      s.fire('assistant.message', {
        content: '',
        toolRequests: [{ toolCallId: 'tc_1' }],
      });

      // Usage for turn 1
      s.fire('assistant.usage', { inputTokens: 100, outputTokens: 20 });

      // Tool execution
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'bash',
        arguments: { command: 'npm install' },
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: true,
        result: { content: 'installed' },
      });

      // Turn end
      s.fire('assistant.turn_end', {});

      // Turn 2: final message with no tools
      s.fire('assistant.message', { content: 'Auth0 integration complete.', toolRequests: [] });
      s.fire('assistant.usage', { inputTokens: 50, outputTokens: 10 });
    });

    const record = await runCopilotAgent(evalDef, workspace);

    expect(record.status).toBe('success');
    expect(record.taskName).toBe('test_eval');
    expect(record.workspace).toBe(workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('run_command');
    expect(record.toolCalls[0].args).toEqual({ command: 'npm install' });
    expect(record.toolCalls[0].result).toBe('installed');
    expect(record.toolCalls[0].causedError).toBe(false);
    expect(record.turnMetrics).toHaveLength(2);
    expect(record.turnMetrics[0].finishReason).toBe('tool_calls');
    expect(record.turnMetrics[1].finishReason).toBe('stop');
    expect(record.finalSummary).toBe('Auth0 integration complete.');
    expect(record.inputTokens).toBe(150);
    expect(record.outputTokens).toBe(30);
    expect(record.providerErrors).toHaveLength(0);
  });

  it('sets sessionId from the SDK session', async () => {
    fakeSession.setScenario(async () => {});
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.sessionId).toBe('fake-session-id');
  });

  it('endTime is always set after completion', async () => {
    fakeSession.setScenario(async () => {});
    const before = Date.now() / 1000;
    const record = await runCopilotAgent(evalDef, workspace);
    const after = Date.now() / 1000;
    expect(record.endTime).toBeGreaterThanOrEqual(before);
    expect(record.endTime).toBeLessThanOrEqual(after + 0.01);
  });

  it('calls session.disconnect and client.stop on cleanup', async () => {
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace);
    expect(fakeSession.disconnect).toHaveBeenCalled();
    expect(mockClientStop).toHaveBeenCalled();
  });

  it('sets finalSummary from sendAndWait return when no assistant.message set it', async () => {
    // Override sendAndWait to return a message
    fakeSession.sendAndWait = async () => ({ data: { content: 'Fallback summary.' } });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Fallback summary.');
  });

  it('does not overwrite finalSummary already set by assistant.message', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('assistant.message', { content: 'From event.', toolRequests: [] });
    });
    // Override sendAndWait to also return content
    const originalScenario = fakeSession.sendAndWait.bind(fakeSession);
    fakeSession.sendAndWait = async function () {
      await originalScenario();
      return { data: { content: 'From return.' } };
    };

    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('From event.');
  });

  it('updates record.model from session.tools_updated event', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('session.tools_updated', { model: 'gpt-5.4-turbo' });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.model).toBe('gpt-5.4-turbo');
  });

  it('updates record.model from tool.execution_complete when still sentinel', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'bash',
        arguments: { command: 'ls' },
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: true,
        result: { content: 'ok' },
        model: 'gpt-5.4-mini',
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.model).toBe('gpt-5.4-mini');
  });

  it('does not overwrite model from tool.execution_complete once already resolved', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('session.tools_updated', { model: 'gpt-5.4-turbo' });
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'bash',
        arguments: {},
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: true,
        result: { content: 'ok' },
        model: 'gpt-5.4-mini',
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.model).toBe('gpt-5.4-turbo');
  });
});

// ── Token tracking ────────────────────────────────────────────────────────────

describe('runCopilotAgent — token tracking', () => {
  it('accumulates tokens from assistant.usage events', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('assistant.message', { content: '', toolRequests: [{ toolCallId: 'tc_1' }] });
      s.fire('assistant.usage', { inputTokens: 100, outputTokens: 20 });
      s.fire('assistant.message', { content: 'done', toolRequests: [] });
      s.fire('assistant.usage', { inputTokens: 50, outputTokens: 10 });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.inputTokens).toBe(150);
    expect(record.outputTokens).toBe(30);
  });

  it('backfills latest TurnMetric with usage data', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('assistant.message', { content: 'hi', toolRequests: [] });
      s.fire('assistant.usage', { inputTokens: 200, outputTokens: 40 });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.turnMetrics[0].inputTokens).toBe(200);
    expect(record.turnMetrics[0].outputTokens).toBe(40);
  });

  it('handles missing token fields gracefully', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('assistant.message', { content: 'hi', toolRequests: [] });
      s.fire('assistant.usage', {});
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.inputTokens).toBe(0);
    expect(record.outputTokens).toBe(0);
    expect(record.costUsd).toBe(0);
    expect(record.turnMetrics[0].inputTokens).toBe(0);
    expect(record.turnMetrics[0].outputTokens).toBe(0);
    expect(record.turnMetrics[0].costUsd).toBe(0);
  });
});

// ── Tool call lifecycle ───────────────────────────────────────────────────────

describe('runCopilotAgent — tool calls', () => {
  it('records tool call with start and complete events', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'read',
        arguments: { path: 'src/app.ts' },
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: true,
        result: { content: 'file contents here' },
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('read_file');
    expect(record.toolCalls[0].args).toEqual({ path: 'src/app.ts' });
    expect(record.toolCalls[0].result).toBe('file contents here');
    expect(record.toolCalls[0].causedError).toBe(false);
  });

  it('records errored tool call with errorCategory', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'bash',
        arguments: { command: 'rm -rf /' },
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: false,
        error: { message: 'permission denied' },
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
    expect(record.toolCalls[0].errorCategory).toBeDefined();
    expect(record.providerErrors.some((e) => e.includes('run_command'))).toBe(true);
  });

  it('uses detailedContent as fallback when content is missing', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'view',
        arguments: { path: 'x.ts' },
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: true,
        result: { detailedContent: 'detailed file output' },
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls[0].result).toBe('detailed file output');
  });

  it('uses <ok> when result has no content or detailedContent', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'write',
        arguments: { path: 'f.ts', content: 'code' },
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: true,
        result: {},
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls[0].result).toBe('<ok>');
  });

  it('uses <error> when error has no message', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'bash',
        arguments: {},
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: false,
        error: {},
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls[0].result).toBe('<error>');
  });

  it('classifies web_fetch as doc lookup', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'web_fetch',
        arguments: { url: 'https://auth0.com/docs' },
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: true,
        result: { content: 'docs' },
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });

  it('filters out internal tools (report_intent, skill)', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_1',
        toolName: 'report_intent',
        arguments: {},
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_1',
        success: true,
        result: { content: 'ok' },
      });
      s.fire('tool.execution_start', {
        toolCallId: 'tc_2',
        toolName: 'skill',
        arguments: {},
      });
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_2',
        success: true,
        result: { content: 'ok' },
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(0);
  });

  it('records orphaned tool result (completion without start) as provider error', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_complete', {
        toolCallId: 'tc_orphan',
        success: true,
        result: { content: 'mystery' },
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(0);
    expect(record.providerErrors.some((e) => e.includes('orphaned tool result'))).toBe(true);
  });
});

// ── Orphaned tool calls (pending at cleanup) ──────────────────────────────────

describe('runCopilotAgent — orphaned pending tools', () => {
  it('drains pending tool calls into toolCalls and providerErrors', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_orphan',
        toolName: 'bash',
        arguments: { command: 'npm install' },
      });
      // No matching tool.execution_complete
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('run_command');
    expect(record.toolCalls[0].result).toBe('<orphaned: result event never received>');
    expect(record.toolCalls[0].causedError).toBe(true);
    expect(record.providerErrors.some((e) => e.includes('orphaned tool call: bash'))).toBe(true);
  });

  it('skips internal tools when draining orphans', async () => {
    fakeSession.setScenario(async (s) => {
      s.fire('tool.execution_start', {
        toolCallId: 'tc_internal',
        toolName: 'report_intent',
        arguments: {},
      });
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(0);
    expect(record.providerErrors.every((e) => !e.includes('report_intent'))).toBe(true);
  });
});

// ── Turn limit ────────────────────────────────────────────────────────────────

describe('runCopilotAgent — turn limit', () => {
  it('aborts and sets failure when MAX_TURNS is reached', async () => {
    fakeSession.setScenario(async (s) => {
      for (let i = 0; i < MAX_TURNS + 5; i++) {
        s.fire('assistant.message', {
          content: '',
          toolRequests: [{ toolCallId: `tc_${i}` }],
        });
      }
    });
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('turn limit'))).toBe(true);
    expect(fakeSession.abort).toHaveBeenCalled();
  });

  it('only records turn limit error once', async () => {
    fakeSession.setScenario(async (s) => {
      for (let i = 0; i < MAX_TURNS + 3; i++) {
        s.fire('assistant.message', { content: '', toolRequests: [{ toolCallId: `tc_${i}` }] });
      }
    });
    const record = await runCopilotAgent(evalDef, workspace);
    const turnLimitErrors = record.providerErrors.filter((e) => e.includes('turn limit'));
    expect(turnLimitErrors).toHaveLength(1);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('runCopilotAgent — error handling', () => {
  it('sendAndWait error sets status to failure', async () => {
    fakeSession.sendAndWait = async () => {
      throw new Error('connection refused');
    };
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('connection refused'))).toBe(true);
  });

  it('timeout error triggers session.abort', async () => {
    fakeSession.sendAndWait = async () => {
      throw new Error('Timeout: session did not respond');
    };
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(fakeSession.abort).toHaveBeenCalled();
  });

  it('non-timeout error does not trigger session.abort', async () => {
    fakeSession.sendAndWait = async () => {
      throw new Error('some other error');
    };
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(fakeSession.abort).not.toHaveBeenCalled();
  });

  it('session.abort failure is swallowed', async () => {
    fakeSession.abort = vi.fn().mockRejectedValue(new Error('abort failed'));
    fakeSession.sendAndWait = async () => {
      throw new Error('Timeout reached');
    };
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    // Should not throw — abort error is caught
  });

  it('session.disconnect failure is swallowed', async () => {
    fakeSession.disconnect = vi.fn().mockRejectedValue(new Error('disconnect failed'));
    fakeSession.setScenario(async () => {});
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.status).toBe('success');
    // Should not throw
  });

  it('client.stop failure is swallowed', async () => {
    mockClientStop.mockRejectedValue(new Error('stop failed'));
    fakeSession.setScenario(async () => {});
    const record = await runCopilotAgent(evalDef, workspace);
    expect(record.status).toBe('success');
    // Should not throw
  });
});

// ── Session configuration ─────────────────────────────────────────────────────

describe('runCopilotAgent — session configuration', () => {
  it('passes model to createSession', async () => {
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace, { model: 'gpt-5.4' });
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.4' }));
  });

  it('passes mcpServers when tools include mcp', async () => {
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace, { tools: ['mcp'] });
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: expect.objectContaining({
          'auth0-docs': expect.objectContaining({ type: 'http' }),
        }),
      }),
    );
  });

  it('does not pass mcpServers when tools do not include mcp', async () => {
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace, { tools: [] });
    const config = mockCreateSession.mock.calls[0][0];
    expect(config.mcpServers).toBeUndefined();
  });

  it('passes skillDirectories when tools include skills', async () => {
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace, { tools: ['skills'] });
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        skillDirectories: [expect.stringContaining('.github/skills')],
      }),
    );
  });

  it('excludes ask_user tool', async () => {
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace);
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ excludedTools: ['ask_user'] }));
  });

  it('disables infinite sessions', async () => {
    fakeSession.setScenario(async () => {});
    await runCopilotAgent(evalDef, workspace);
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ infiniteSessions: { enabled: false } }));
  });
});

// ── CopilotCliRunner ──────────────────────────────────────────────────────────

describe('CopilotCliRunner — model routing', () => {
  const runner = new CopilotCliRunner();
  const runnerEvalDef = { id: 'test', userPrompt: 'test', name: 'test', category: 'test', scaffold: undefined };

  it('passes through GPT model names (gpt-*)', async () => {
    fakeSession.setScenario(async () => {});
    const result = await runner.run({ evalDef: runnerEvalDef, workspace, model: 'gpt-5.4-mini', tools: [] });
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.4-mini' }));
    // resolvedModel comes from record.model which defaults to COPILOT_MODEL_ID
    // when no session.tools_updated event resolves it.
    expect(result.resolvedModel).toBe(COPILOT_MODEL_ID);
  });

  // The runner uses `model.startsWith('o')` — this intentionally matches the
  // broad OpenAI "o*" family (o1, o3, o4-mini, etc.) without restricting to a
  // specific pattern. Any model starting with 'o' is treated as GPT-compatible.
  it('passes through o-prefix models', async () => {
    fakeSession.setScenario(async () => {});
    await runner.run({ evalDef: runnerEvalDef, workspace, model: 'o4-mini', tools: [] });
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'o4-mini' }));
  });

  it('falls back to default model for claude-* models', async () => {
    fakeSession.setScenario(async () => {});
    await runner.run({ evalDef: runnerEvalDef, workspace, model: 'claude-sonnet-4-6', tools: [] });
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: COPILOT_DEFAULT_MODEL }));
  });

  it('falls back to default model for gemini-* models', async () => {
    fakeSession.setScenario(async () => {});
    await runner.run({ evalDef: runnerEvalDef, workspace, model: 'gemini-3.1-pro-preview', tools: [] });
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: COPILOT_DEFAULT_MODEL }));
  });

  it('falls back to default model for copilot sentinel', async () => {
    fakeSession.setScenario(async () => {});
    await runner.run({ evalDef: runnerEvalDef, workspace, model: 'copilot', tools: [] });
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: COPILOT_DEFAULT_MODEL }));
  });
});
