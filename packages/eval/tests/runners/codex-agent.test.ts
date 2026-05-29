/**
 * Unit tests for runCodexAgent in codex/agent.ts.
 *
 * Mocks `spawn` to return a controlled child process that emits JSONL events
 * via stdout, verifying that RunRecord fields (toolCalls, turnMetrics, status,
 * finalSummary, etc.) are populated correctly for the common event sequences:
 *
 *   - item.started + item.completed[command_execution] → ToolCallRecord
 *   - function_call + function_call_output (standalone) → ToolCallRecord
 *   - duplicate events for same callId → deduplicated to one ToolCallRecord
 *   - exit_code undefined → not treated as error
 *   - turn.completed → TurnMetric with token counts
 *   - orphaned pending calls drained on close
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// ── Mock fs to avoid touching the filesystem ─────────────────────────────────

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    realpathSync: vi.fn((p: string) => p),
  };
});

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock framework config ─────────────────────────────────────────────────────

const mockGetFrameworkConfig = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
    mcp: { servers: {} },
  }),
);

vi.mock('@a0/eval-core', async () => ({
  ...(await vi.importActual('@a0/eval-core')),
  getAgentProxyBaseUrl: vi.fn().mockReturnValue('<LLM_PROXY_URL>'),
  getFrameworkConfig: mockGetFrameworkConfig,
}));

// ── Mock spawn ────────────────────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

import { MAX_TURNS } from '@a0/eval-core';
import { writeFileSync } from 'node:fs';
import { runCodexAgent } from '../../src/runners/codex/agent.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type JsonlEvent = Record<string, unknown>;

/**
 * Returns a fake child process whose stdout emits `events` as JSONL lines then
 * closes with `exitCode`.
 */
function makeChild(events: JsonlEvent[], exitCode = 0) {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn();

  setImmediate(() => {
    for (const ev of events) {
      stdout.push(JSON.stringify(ev) + '\n');
    }
    stdout.push(null);
    stderr.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

/** Minimal turn.completed event. */
function turnCompleted(overrides: { input_tokens?: number; output_tokens?: number } = {}): JsonlEvent {
  return {
    type: 'turn.completed',
    usage: {
      input_tokens: overrides.input_tokens ?? 0,
      output_tokens: overrides.output_tokens ?? 0,
    },
  };
}

const evalDef = { id: 'react_quickstart', userPrompt: 'Add Auth0 login.' };
const workspace = '/tmp/test-workspace';

beforeEach(() => {
  mockSpawn.mockReset();
  vi.clearAllMocks();
  // Default: resume spawns get an empty immediately-closing child.
  mockSpawn.mockImplementation(() => makeChild([]));
});

// ── thread.started ────────────────────────────────────────────────────────────

describe('thread.started event', () => {
  it('sets sessionId from thread_id', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([{ type: 'thread.started', thread_id: 'thread-abc-123' }, turnCompleted()]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.sessionId).toBe('thread-abc-123');
  });
});

// ── command_execution ─────────────────────────────────────────────────────────

describe('command_execution events', () => {
  it('creates ToolCallRecord for item.started + item.completed[command_execution]', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'item.started', item: { type: 'command_execution', id: 'item_1', command: 'npm install' } },
        {
          type: 'item.completed',
          item: {
            type: 'command_execution',
            id: 'item_1',
            command: 'npm install',
            aggregated_output: 'added 10 packages',
            exit_code: 0,
          },
        },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    const tc = record.toolCalls[0];
    expect(tc.name).toBe('run_command');
    expect(tc.args).toEqual({ command: 'npm install' });
    expect(tc.result).toBe('added 10 packages');
    expect(tc.causedError).toBe(false);
  });

  it('marks command_execution with non-zero exit_code as causedError', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'item.started', item: { type: 'command_execution', id: 'item_1', command: 'npm test' } },
        {
          type: 'item.completed',
          item: {
            type: 'command_execution',
            id: 'item_1',
            command: 'npm test',
            aggregated_output: 'test failed',
            exit_code: 1,
          },
        },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
  });

  it('treats undefined exit_code as success (not error)', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'item.started', item: { type: 'command_execution', id: 'item_1', command: 'ls' } },
        {
          type: 'item.completed',
          item: { type: 'command_execution', id: 'item_1', command: 'ls', aggregated_output: 'src/' },
          // exit_code intentionally omitted
        },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(false);
  });
});

// ── function_call / function_call_output ──────────────────────────────────────

describe('function_call events', () => {
  it('creates ToolCallRecord for standalone function_call + function_call_output', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        {
          type: 'function_call',
          name: 'read_file',
          call_id: 'call_1',
          arguments: JSON.stringify({ path: 'src/app.ts' }),
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'file contents' },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    const tc = record.toolCalls[0];
    expect(tc.name).toBe('read_file');
    expect(tc.args).toEqual({ path: 'src/app.ts' });
    expect(tc.result).toBe('file contents');
    expect(tc.causedError).toBe(false);
  });

  it('marks function_call_output starting with "Error:" as causedError', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'function_call', name: 'read_file', call_id: 'call_1', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'Error: file not found' },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
  });

  it('deduplicates when both standalone and item.completed fire for same callId', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'turn.started' },
        // Standalone stream
        { type: 'function_call', name: 'write_file', call_id: 'call_1', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
        // item.completed stream for same call — should not inflate toolCallCount
        {
          type: 'item.completed',
          item: { type: 'function_call', name: 'write_file', call_id: 'call_1', arguments: '{}' },
        },
        { type: 'item.completed', item: { type: 'function_call_output', call_id: 'call_1', output: 'ok' } },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.turnMetrics[0].toolCallCount).toBe(1);
  });

  it('classifies web_fetch as doc lookup', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        {
          type: 'function_call',
          name: 'web_fetch',
          call_id: 'call_1',
          arguments: JSON.stringify({ url: 'https://auth0.com/docs' }),
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'doc content' },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });
});

// ── mcp_tool_call events ──────────────────────────────────────────────────────

describe('mcp_tool_call events', () => {
  it('creates ToolCallRecord with mcp__ name for item.started + item.completed[mcp_tool_call]', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        {
          type: 'item.started',
          item: { type: 'mcp_tool_call', id: 'mcp_1', server: 'auth0-docs', tool: 'search_auth0_docs', arguments: { query: 'quickstart' } },
        },
        {
          type: 'item.completed',
          item: {
            type: 'mcp_tool_call',
            id: 'mcp_1',
            server: 'auth0-docs',
            tool: 'search_auth0_docs',
            arguments: { query: 'quickstart' },
            result: { content: [{ text: 'Auth0 quickstart guide' }] },
            error: null,
            status: 'completed',
          },
        },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    const tc = record.toolCalls[0];
    expect(tc.name).toBe('mcp__auth0-docs__search_auth0_docs');
    expect(tc.causedError).toBe(false);
    expect(tc.isDocLookup).toBe(true);
  });

  it('marks mcp_tool_call with error as causedError', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        {
          type: 'item.started',
          item: { type: 'mcp_tool_call', id: 'mcp_2', server: 'auth0-docs', tool: 'search_auth0_docs', arguments: {} },
        },
        {
          type: 'item.completed',
          item: {
            type: 'mcp_tool_call',
            id: 'mcp_2',
            server: 'auth0-docs',
            tool: 'search_auth0_docs',
            arguments: {},
            result: null,
            error: 'server unavailable',
            status: 'failed',
          },
        },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
    expect(record.toolCalls[0].result).toContain('server unavailable');
  });

  it('deduplicates mcp_tool_call when item.completed fires twice for same id', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        {
          type: 'item.started',
          item: { type: 'mcp_tool_call', id: 'mcp_3', server: 'auth0-docs', tool: 'search_auth0_docs', arguments: {} },
        },
        {
          type: 'item.completed',
          item: { type: 'mcp_tool_call', id: 'mcp_3', server: 'auth0-docs', tool: 'search_auth0_docs', arguments: {}, result: 'ok', error: null, status: 'completed' },
        },
        {
          type: 'item.completed',
          item: { type: 'mcp_tool_call', id: 'mcp_3', server: 'auth0-docs', tool: 'search_auth0_docs', arguments: {}, result: 'ok', error: null, status: 'completed' },
        },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
  });

  it('counts mcp_tool_call in turnMetrics toolCallCount', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        {
          type: 'item.started',
          item: { type: 'mcp_tool_call', id: 'mcp_4', server: 'auth0-docs', tool: 'search_auth0_docs', arguments: {} },
        },
        {
          type: 'item.completed',
          item: { type: 'mcp_tool_call', id: 'mcp_4', server: 'auth0-docs', tool: 'search_auth0_docs', arguments: {}, result: 'results', error: null, status: 'completed' },
        },
        turnCompleted({ input_tokens: 50, output_tokens: 20 }),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.turnMetrics[0].toolCallCount).toBe(1);
    expect(record.turnMetrics[0].finishReason).toBe('tool_calls');
  });
});

// ── turn metrics ──────────────────────────────────────────────────────────────

describe('turn metrics', () => {
  it('turn.completed creates TurnMetric with token counts', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'item.started', item: { type: 'command_execution', id: 'i1', command: 'ls' } },
        {
          type: 'item.completed',
          item: { type: 'command_execution', id: 'i1', command: 'ls', aggregated_output: 'src/', exit_code: 0 },
        },
        turnCompleted({ input_tokens: 100, output_tokens: 50 }),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(1);
    const tm = record.turnMetrics[0];
    expect(tm.turn).toBe(1);
    expect(tm.inputTokens).toBe(100);
    expect(tm.outputTokens).toBe(50);
    expect(tm.toolCallCount).toBe(1);
    expect(tm.finishReason).toBe('tool_calls');
  });

  it('turn with no tool calls has finishReason stop', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([{ type: 'message', role: 'assistant', content: 'Done.' }, turnCompleted()]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
    expect(record.turnMetrics[0].toolCallCount).toBe(0);
  });

  it('accumulates tokens across multiple turns', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'item.started', item: { type: 'command_execution', id: 'i1', command: 'ls' } },
        {
          type: 'item.completed',
          item: { type: 'command_execution', id: 'i1', command: 'ls', aggregated_output: '', exit_code: 0 },
        },
        turnCompleted({ input_tokens: 100, output_tokens: 30 }),
        { type: 'item.started', item: { type: 'command_execution', id: 'i2', command: 'cat' } },
        {
          type: 'item.completed',
          item: { type: 'command_execution', id: 'i2', command: 'cat', aggregated_output: '', exit_code: 0 },
        },
        turnCompleted({ input_tokens: 200, output_tokens: 40 }),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(2);
    expect(record.inputTokens).toBe(300);
    expect(record.outputTokens).toBe(70);
  });
});

// ── finalSummary ──────────────────────────────────────────────────────────────

describe('finalSummary', () => {
  it('sets finalSummary from message event', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([{ type: 'message', role: 'assistant', content: 'Auth0 integration complete.' }, turnCompleted()]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Auth0 integration complete.');
  });

  it('sets finalSummary from item.completed[agent_message]', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'item.completed', item: { type: 'agent_message', text: 'Done via item.completed.' } },
        turnCompleted(),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Done via item.completed.');
  });
});

// ── orphaned tool calls ───────────────────────────────────────────────────────

describe('orphaned tool calls', () => {
  it('drains pending command_execution with no completion into toolCalls with causedError on close', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild(
        [{ type: 'item.started', item: { type: 'command_execution', id: 'orphan1', command: 'npm install' } }],
        1,
      ),
    );

    const record = await runCodexAgent(evalDef, workspace);
    const orphaned = record.toolCalls.find((tc) => tc.args?.command === 'npm install');
    expect(orphaned).toBeDefined();
    expect(orphaned?.causedError).toBe(true);
    expect(record.providerErrors.some((e) => e.includes('orphaned tool call'))).toBe(true);
  });
});

// ── status and final state ────────────────────────────────────────────────────

describe('status and final state', () => {
  it('successful run sets status success', async () => {
    mockSpawn.mockReturnValueOnce(
      makeChild([
        { type: 'message', role: 'assistant', content: 'Done.' },
        turnCompleted({ input_tokens: 100, output_tokens: 20 }),
      ]),
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.status).toBe('success');
  });

  it('spawn error event sets status to failure', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.kill = vi.fn();
    setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
    mockSpawn.mockReturnValueOnce(child);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('spawn ENOENT'))).toBe(true);
  });

  it('turn.failed adds to providerErrors', async () => {
    mockSpawn.mockReturnValueOnce(makeChild([{ type: 'turn.failed', error: { message: 'rate limit exceeded' } }]));

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.providerErrors.some((e) => e.includes('rate limit exceeded'))).toBe(true);
  });

  it('kills subprocess when MAX_TURNS is reached', async () => {
    const events: JsonlEvent[] = [];
    for (let i = 0; i < MAX_TURNS + 2; i++) {
      events.push({ type: 'item.started', item: { type: 'command_execution', id: `i${i}`, command: 'ls' } });
      events.push({
        type: 'item.completed',
        item: { type: 'command_execution', id: `i${i}`, command: 'ls', aggregated_output: '', exit_code: 0 },
      });
      events.push(turnCompleted());
    }

    const child = makeChild(events);
    mockSpawn.mockReturnValueOnce(child);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('turn limit'))).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('endTime is always set after completion', async () => {
    mockSpawn.mockReturnValueOnce(makeChild([], 1));

    const before = Date.now() / 1000;
    const record = await runCodexAgent(evalDef, workspace);
    const after = Date.now() / 1000;

    expect(record.endTime).toBeGreaterThanOrEqual(before);
    expect(record.endTime).toBeLessThanOrEqual(after + 0.1);
  });
});

// ── MCP integration ───────────────────────────────────────────────────────────

describe('MCP integration', () => {
  beforeEach(() => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
      mcp: { servers: {} },
    });
  });

  it('writes http MCP server block to config.toml', async () => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
      mcp: {
        servers: {
          'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
        },
      },
    });
    mockSpawn.mockReturnValueOnce(
      makeChild([{ type: 'message', role: 'assistant', content: 'Done.' }, turnCompleted()]),
    );

    await runCodexAgent(evalDef, workspace, { tools: ['mcp'] });

    const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).endsWith('config.toml'),
    );
    expect(written).toBeDefined();
    if (!written) return;
    const toml = written[1] as string;
    expect(toml).toContain('[mcp_servers."auth0-docs"]');
    expect(toml).toContain('url = "https://auth0.com/docs/mcp"');
  });

  it('writes stdio MCP server block with args and env_vars to config.toml', async () => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
      mcp: {
        servers: {
          'local-tool': {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@auth0/mcp-tool'],
            env: { AUTH0_TOKEN: 'tok_abc' },
          },
        },
      },
    });
    mockSpawn.mockReturnValueOnce(
      makeChild([{ type: 'message', role: 'assistant', content: 'Done.' }, turnCompleted()]),
    );

    await runCodexAgent(evalDef, workspace, { tools: ['mcp'] });

    const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).endsWith('config.toml'),
    );
    expect(written).toBeDefined();
    if (!written) return;
    const toml = written[1] as string;
    expect(toml).toContain('[mcp_servers."local-tool"]');
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('"-y"');
    expect(toml).toContain('"@auth0/mcp-tool"');
    expect(toml).toContain('"AUTH0_TOKEN"');
  });

  it('injects stdio MCP server env vars into codexEnv', async () => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
      mcp: {
        servers: {
          'local-tool': {
            type: 'stdio',
            command: 'npx',
            args: [],
            env: { MY_SECRET_TOKEN: 'secret123' },
          },
        },
      },
    });
    mockSpawn.mockReturnValueOnce(
      makeChild([{ type: 'message', role: 'assistant', content: 'Done.' }, turnCompleted()]),
    );

    await runCodexAgent(evalDef, workspace, { tools: ['mcp'] });

    const spawnCall = mockSpawn.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(spawnCall[2].env['MY_SECRET_TOKEN']).toBe('secret123');
  });

  it('does not write MCP sections when tools does not include mcp', async () => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
      mcp: {
        servers: {
          'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
        },
      },
    });
    mockSpawn.mockReturnValueOnce(
      makeChild([{ type: 'message', role: 'assistant', content: 'Done.' }, turnCompleted()]),
    );

    await runCodexAgent(evalDef, workspace, { tools: [] });

    const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).endsWith('config.toml'),
    );
    expect(written).toBeDefined();
    if (!written) return;
    const toml = written[1] as string;
    expect(toml).not.toContain('mcp_servers');
  });
});
