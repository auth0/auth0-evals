/**
 * Unit tests for runGeminiCliAgent in gemini-cli/agent.ts.
 *
 * Mocks `spawn` to return a controlled child process that emits JSONL events
 * via stdout, verifying that RunRecord fields (toolCalls, turnMetrics, status,
 * finalSummary, etc.) are populated correctly for the common event sequences:
 *
 *   - tool_use + tool_result → ToolCallRecord
 *   - non-delta message     → TurnMetric with per-turn llmLatency
 *   - delta-only message(s) + result → TurnMetric flushed at result with finishReason 'stop'
 *   - orphaned tool_use (no result) → drained on close
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Mock framework config ────────────────────────────────────────────────────

const mockGetFrameworkConfig = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    proxy: { baseUrl: 'https://llm.example.com/v1' },
    mcp: {
      servers: {
        'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
      },
    },
  }),
);
const mintMcpTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@a0/eval-core', async () => ({
  ...(await vi.importActual('@a0/eval-core')),
  getFrameworkConfig: mockGetFrameworkConfig,
  mintMcpToken: mintMcpTokenMock,
}));

// ── Mock spawn ────────────────────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

import { MAX_TURNS } from '@a0/eval-core';
import { runGeminiCliAgent } from '../../src/runners/gemini-cli/agent.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type JsonlEvent = Record<string, unknown>;

/**
 * Returns a fake child process whose stdout emits `events` as JSONL lines then
 * closes with `exitCode`. Lines are pushed via setImmediate so readline has time
 * to attach its 'data' listener before data arrives.
 */
function makeChild(events: JsonlEvent[], exitCode = 0, stderrText = '') {
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
    if (stderrText) stderr.push(Buffer.from(stderrText));
    stderr.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

/** Minimal result event — used when we only care about testing other events. */
function resultEvent(
  overrides: { input_tokens?: number; output_tokens?: number; duration_ms?: number; tool_calls?: number } = {},
): JsonlEvent {
  return {
    type: 'result',
    status: 'success',
    stats: {
      input_tokens: overrides.input_tokens ?? 0,
      output_tokens: overrides.output_tokens ?? 0,
      duration_ms: overrides.duration_ms ?? 0,
      tool_calls: overrides.tool_calls ?? 0,
    },
  };
}

const evalDef = { id: 'swift_quickstart', userPrompt: 'Add Auth0 to my app.' };
const workspace = '/tmp/test-workspace';

beforeEach(() => mockSpawn.mockReset());

// ── init event ────────────────────────────────────────────────────────────────

describe('init event', () => {
  it('sets sessionId from init event', async () => {
    mockSpawn.mockReturnValue(
      makeChild([{ type: 'init', session_id: 'abc-123', model: 'gemini-3.1-pro' }, resultEvent()]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.sessionId).toBe('abc-123');
  });
});

// ── tool events ───────────────────────────────────────────────────────────────

describe('tool events', () => {
  it('creates ToolCallRecord for matching tool_use + tool_result', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'tool_use', tool_id: 't1', tool_name: 'read_file', parameters: { file_path: 'src/app.ts' } },
        { type: 'tool_result', tool_id: 't1', status: 'success', output: 'file contents' },
        { type: 'message', role: 'assistant', content: 'Done.', delta: true },
        resultEvent({ input_tokens: 100, output_tokens: 50, tool_calls: 1 }),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    const tc = record.toolCalls[0];
    expect(tc.name).toBe('read_file');
    expect(tc.result).toBe('file contents');
    expect(tc.causedError).toBe(false);
    expect(tc.args).toEqual({ path: 'src/app.ts' });
  });

  it('marks tool_result with error status as causedError', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'tool_use', tool_id: 't1', tool_name: 'run_shell_command', parameters: { command: 'npm install' } },
        { type: 'tool_result', tool_id: 't1', status: 'error', output: 'ENOENT: not found' },
        { type: 'message', role: 'assistant', content: 'Error.', delta: true },
        resultEvent(),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
  });

  it('marks an auto-cancelled (timed-out) command as causedError even when status is success', async () => {
    // Gemini CLI cancels a command that exceeds its own internal timeout but still
    // reports the tool_result with status:"success", placing the cancellation notice
    // only in the output text. The timeout must still count as an error.
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool_use',
          tool_id: 't1',
          tool_name: 'run_shell_command',
          parameters: { command: 'npx nuxi typecheck' },
        },
        {
          type: 'tool_result',
          tool_id: 't1',
          status: 'success',
          output:
            'Command was automatically cancelled because it exceeded the timeout of 5.0 minutes without output.\n\nOutput before cancellation:\n\nℹ Nuxt collects completely anonymous data about usage.',
        },
        { type: 'message', role: 'assistant', content: 'Timed out.', delta: true },
        resultEvent(),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
    expect(record.toolCalls[0].errorCategory).toBe('timeout');
  });

  it.each([
    ['read_file', 'read_file'],
    ['write_file', 'write_file'],
    ['edit_file', 'write_file'],
    ['replace_in_file', 'write_file'],
    ['run_shell_command', 'run_command'],
    ['list_directory', 'list_files'],
    ['create_directory', 'run_command'],
    ['glob', 'list_files'],
    ['grep', 'list_files'],
    ['web_fetch', 'fetch_url'],
  ])('maps Gemini tool name "%s" → canonical "%s"', async (geminiName, expectedName) => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'tool_use', tool_id: 't1', tool_name: geminiName, parameters: {} },
        { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
        { type: 'message', role: 'assistant', content: 'Done.', delta: true },
        resultEvent(),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.toolCalls[0].name).toBe(expectedName);
  });

  it('mcp__-prefixed tool preserves full name and is classified as doc lookup', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool_use',
          tool_id: 't1',
          tool_name: 'mcp__auth0-docs__search_auth0_docs',
          parameters: { query: 'login' },
        },
        { type: 'tool_result', tool_id: 't1', status: 'success', output: 'docs result' },
        { type: 'message', role: 'assistant', content: 'Done.', delta: true },
        resultEvent(),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.toolCalls[0].name).toBe('mcp__auth0-docs__search_auth0_docs');
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });

  it('normalizes Gemini single-underscore mcp_ names to the mcp__ convention', async () => {
    // Gemini CLI >=0.46 emits `mcp_<server>_<tool>` (single underscore); the
    // trace-based MCP graders require the `mcp__` double-underscore prefix.
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool_use',
          tool_id: 't1',
          tool_name: 'mcp_auth0-hosted-mcp_auth0_list_applications',
          parameters: {},
        },
        { type: 'tool_result', tool_id: 't1', status: 'success', output: '{"applications":[]}' },
        { type: 'message', role: 'assistant', content: 'Done.', delta: true },
        resultEvent(),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.toolCalls[0].name).toBe('mcp__auth0-hosted-mcp_auth0_list_applications');
    expect(record.toolCalls[0].name.startsWith('mcp__')).toBe(true);
  });

  it('web_fetch tool is classified as a doc lookup', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'tool_use', tool_id: 't1', tool_name: 'web_fetch', parameters: { url: 'https://auth0.com/docs' } },
        { type: 'tool_result', tool_id: 't1', status: 'success', output: 'doc page' },
        { type: 'message', role: 'assistant', content: 'Done.', delta: true },
        resultEvent(),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });
});

// ── turn metrics ──────────────────────────────────────────────────────────────

describe('turn metrics', () => {
  it('non-delta message closes turn with per-turn llmLatency', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'tool_use', tool_id: 't1', tool_name: 'read_file', parameters: {} },
        { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
        // Non-delta: turn is complete
        { type: 'message', role: 'assistant', content: 'Done.', delta: false },
        resultEvent({ input_tokens: 100, output_tokens: 20, duration_ms: 3000, tool_calls: 1 }),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(1);
    const tm = record.turnMetrics[0];
    expect(tm.turn).toBe(1);
    expect(tm.toolCallCount).toBe(1);
    expect(tm.finishReason).toBe('tool_calls');
    // Per-turn latency — should be small (close handler runs almost immediately in tests)
    expect(tm.llmLatency).toBeGreaterThanOrEqual(0);
    expect(tm.llmLatency).toBeLessThan(5);
  });

  it('non-delta with no tool calls has finishReason stop', async () => {
    mockSpawn.mockReturnValue(
      makeChild([{ type: 'message', role: 'assistant', content: 'Done.', delta: false }, resultEvent()]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
    expect(record.turnMetrics[0].toolCallCount).toBe(0);
  });

  it('delta-only turn is flushed at result with finishReason stop', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'tool_use', tool_id: 't1', tool_name: 'write_file', parameters: {} },
        { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
        // Only delta chunks — no closing non-delta
        { type: 'message', role: 'assistant', content: 'First chunk.', delta: true },
        { type: 'message', role: 'assistant', content: 'Second chunk.', delta: true },
        resultEvent({ input_tokens: 200, output_tokens: 80, duration_ms: 7500, tool_calls: 1 }),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(1);
    const tm = record.turnMetrics[0];
    expect(tm.turn).toBe(1);
    expect(tm.finishReason).toBe('stop');
    expect(tm.toolCallCount).toBe(1);
    // llmLatency is back-filled from durationMs / 1000 = 7.5s
    expect(tm.llmLatency).toBe(7.5);
  });

  it('delta-only turn with no tools has finishReason stop and toolCallCount 0', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'message', role: 'assistant', content: 'Streaming text.', delta: true },
        resultEvent({ duration_ms: 2000 }),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
    expect(record.turnMetrics[0].toolCallCount).toBe(0);
  });

  it('back-fills last TurnMetric with authoritative token counts from result event', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'message', role: 'assistant', content: 'Done.', delta: true },
        resultEvent({ input_tokens: 500, output_tokens: 150, duration_ms: 4000 }),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    const tm = record.turnMetrics[0];
    expect(tm.inputTokens).toBe(500);
    expect(tm.outputTokens).toBe(150);
    expect(tm.llmLatency).toBe(4); // 4000 ms / 1000
  });

  it('multiple non-delta turns each get their own TurnMetric', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        // Turn 1
        { type: 'tool_use', tool_id: 't1', tool_name: 'read_file', parameters: {} },
        { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
        { type: 'message', role: 'assistant', content: 'Read done.', delta: false },
        // Turn 2
        { type: 'tool_use', tool_id: 't2', tool_name: 'write_file', parameters: {} },
        { type: 'tool_result', tool_id: 't2', status: 'success', output: 'ok' },
        { type: 'message', role: 'assistant', content: 'Write done.', delta: false },
        resultEvent({ input_tokens: 300, output_tokens: 60, duration_ms: 6000, tool_calls: 2 }),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(2);
    expect(record.turnMetrics[0].turn).toBe(1);
    expect(record.turnMetrics[0].toolCallCount).toBe(1);
    expect(record.turnMetrics[1].turn).toBe(2);
    expect(record.turnMetrics[1].toolCallCount).toBe(1);
  });

  it('no turn metrics when process exits with no output', async () => {
    mockSpawn.mockReturnValue(makeChild([], 1));

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(0);
  });
});

// ── orphaned tool calls ───────────────────────────────────────────────────────

describe('orphaned tool calls', () => {
  it('drains pending tool_use with no result into toolCalls with causedError on close', async () => {
    mockSpawn.mockReturnValue(
      makeChild(
        [{ type: 'tool_use', tool_id: 'orphan1', tool_name: 'write_file', parameters: { file_path: 'out.ts' } }],
        1,
      ),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    const orphaned = record.toolCalls.find((tc) => tc.args?.path === 'out.ts');
    expect(orphaned).toBeDefined();
    expect(orphaned?.causedError).toBe(true);
    expect(orphaned?.result).toBe('');
    expect(record.providerErrors.some((e) => e.includes('orphaned tool call: write_file'))).toBe(true);
  });

  it('multiple orphaned tool_use events are all drained', async () => {
    mockSpawn.mockReturnValue(
      makeChild(
        [
          { type: 'tool_use', tool_id: 'o1', tool_name: 'read_file', parameters: {} },
          { type: 'tool_use', tool_id: 'o2', tool_name: 'write_file', parameters: {} },
        ],
        1,
      ),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(2);
    expect(record.toolCalls.every((tc) => tc.causedError)).toBe(true);
    expect(record.providerErrors.filter((e) => e.startsWith('orphaned tool call:'))).toHaveLength(2);
  });
});

// ── status and final state ─────────────────────────────────────────────────────

describe('status and final state', () => {
  it('successful run with result event sets status success and tokens', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'message', role: 'assistant', content: 'Integration complete.', delta: true },
        resultEvent({ input_tokens: 100, output_tokens: 30 }),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.status).toBe('success');
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(30);
    expect(record.finalSummary).toBe('Integration complete.');
  });

  it('non-zero exit with no tool calls or summary sets status to failure', async () => {
    mockSpawn.mockReturnValue(makeChild([], 1, 'fatal error'));

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('gemini exited with code 1'))).toBe(true);
  });

  it('non-zero exit but with tool calls and summary is still success', async () => {
    // Gemini CLI exits non-zero on 503 retries but may have completed the task
    mockSpawn.mockReturnValue(
      makeChild(
        [
          { type: 'tool_use', tool_id: 't1', tool_name: 'write_file', parameters: {} },
          { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
          { type: 'message', role: 'assistant', content: 'Done despite 503.', delta: true },
          resultEvent(),
        ],
        1, // non-zero exit
      ),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
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
    mockSpawn.mockReturnValue(child);

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('spawn ENOENT'))).toBe(true);
  });

  it('kills subprocess when MAX_TURNS is reached', async () => {
    const events: JsonlEvent[] = [];
    for (let i = 0; i < MAX_TURNS + 5; i++) {
      events.push({ type: 'tool_use', tool_id: `t${i}`, tool_name: 'read_file', parameters: {} });
      events.push({ type: 'tool_result', tool_id: `t${i}`, status: 'success', output: 'ok' });
      events.push({ type: 'message', role: 'assistant', content: `Turn ${i + 1}.`, delta: false });
    }
    events.push(resultEvent());

    const child = makeChild(events);
    mockSpawn.mockReturnValue(child);

    const record = await runGeminiCliAgent(evalDef, workspace);

    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('turn limit'))).toBe(true);
    // child.kill is mocked so the stream isn't actually stopped — turns may
    // exceed MAX_TURNS in the test. In production SIGTERM kills the process.
    expect(record.turnMetrics.length).toBeGreaterThanOrEqual(MAX_TURNS);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('endTime is always set after completion', async () => {
    mockSpawn.mockReturnValue(makeChild([], 1));

    const before = Date.now() / 1000;
    const record = await runGeminiCliAgent(evalDef, workspace);
    const after = Date.now() / 1000;

    expect(record.endTime).toBeGreaterThanOrEqual(before);
    expect(record.endTime).toBeLessThanOrEqual(after + 0.1);
  });

  it('finalSummary is set from last assistant message content', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'message', role: 'assistant', content: 'First response.', delta: true },
        { type: 'message', role: 'assistant', content: 'Final response.', delta: true },
        resultEvent(),
      ]),
    );

    const record = await runGeminiCliAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Final response.');
  });
});

// ── .gemini/settings.json ──────────────────────────────────────────────────

describe('.gemini/settings.json', () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'gemini-settings-'));
  });

  afterEach(() => {
    rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  function readSettings(): Record<string, unknown> {
    const path = join(tmpWorkspace, '.gemini', 'settings.json');
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  }

  it('pins gemini-api-key auth type even when MCP is disabled', async () => {
    // Gemini CLI 0.45+ returns the unvalidated `gateway` auth type when
    // GOOGLE_GEMINI_BASE_URL is set; pinning the validated type prevents the
    // "Invalid auth method selected." failure.
    mockSpawn.mockReturnValue(makeChild([resultEvent()]));

    await runGeminiCliAgent(evalDef, tmpWorkspace, { tools: [] });

    const settings = readSettings();
    expect(settings.security).toEqual({ auth: { selectedType: 'gemini-api-key' } });
    expect(settings).not.toHaveProperty('mcpServers');
  });

  it('registers HTTP MCP servers alongside the pinned auth type when MCP is enabled', async () => {
    mockSpawn.mockReturnValue(makeChild([resultEvent()]));

    await runGeminiCliAgent(evalDef, tmpWorkspace, { tools: ['mcp'] });

    const settings = readSettings();
    expect(settings.security).toEqual({ auth: { selectedType: 'gemini-api-key' } });
    expect(settings.mcpServers).toEqual({
      'auth0-docs': { httpUrl: 'https://auth0.com/docs/mcp', timeout: 30000 },
    });
  });

  it('always writes settings.json so auth is pinned for every run', async () => {
    mockSpawn.mockReturnValue(makeChild([resultEvent()]));

    await runGeminiCliAgent(evalDef, tmpWorkspace, { tools: ['skills'] });

    expect(existsSync(join(tmpWorkspace, '.gemini', 'settings.json'))).toBe(true);
  });

  it('mints a token and writes an env-var Authorization header for authed servers', async () => {
    mockSpawn.mockReturnValue(makeChild([resultEvent()]));
    mintMcpTokenMock.mockResolvedValueOnce('minted-token');
    mockGetFrameworkConfig.mockReturnValueOnce({
      proxy: { baseUrl: 'https://llm.example.com/v1' },
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

    await runGeminiCliAgent(evalDef, tmpWorkspace, { tools: ['mcp'] });

    // The header references an env var — the token is never written to disk;
    // Gemini CLI expands `${MCP_BEARER_*}` from the subprocess env at load time.
    const settings = readSettings();
    expect(settings.mcpServers).toEqual({
      'auth0-hosted-mcp': {
        httpUrl: 'https://tenant.auth0.com/v1/mcp',
        timeout: 30000,
        headers: { Authorization: 'Bearer ${MCP_BEARER_AUTH0_HOSTED_MCP}' },
      },
    });
    // The raw token must not leak into the settings file.
    const raw = readFileSync(join(tmpWorkspace, '.gemini', 'settings.json'), 'utf-8');
    expect(raw).not.toContain('minted-token');

    // The token is injected into the subprocess env under the referenced name.
    const spawnEnv = (mockSpawn.mock.calls[0] as [string, string[], { env: Record<string, string> }])[2].env;
    expect(spawnEnv.MCP_BEARER_AUTH0_HOSTED_MCP).toBe('minted-token');
  });

  it('registers authed and unauthed servers together, only the authed one carrying a header', async () => {
    // Mirrors the production eval.config.js: auth0-docs (unauthed) and
    // auth0-hosted-mcp (authed) side by side. Both must land in the config,
    // but only the authed server gets an Authorization header.
    mockSpawn.mockReturnValue(makeChild([resultEvent()]));
    mintMcpTokenMock.mockClear();
    mintMcpTokenMock.mockResolvedValueOnce('minted-token');
    mockGetFrameworkConfig.mockReturnValueOnce({
      proxy: { baseUrl: 'https://llm.example.com/v1' },
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
    });

    await runGeminiCliAgent(evalDef, tmpWorkspace, { tools: ['mcp'] });

    const settings = readSettings();
    expect(settings.mcpServers).toEqual({
      'auth0-docs': { httpUrl: 'https://auth0.com/docs/mcp', timeout: 30000 },
      'auth0-hosted-mcp': {
        httpUrl: 'https://tenant.auth0.com/v1/mcp',
        timeout: 30000,
        headers: { Authorization: 'Bearer ${MCP_BEARER_AUTH0_HOSTED_MCP}' },
      },
    });
    // The token is minted exactly once — the unauthed server never triggers a mint.
    expect(mintMcpTokenMock).toHaveBeenCalledOnce();
  });

  it('skips an authed server when the token mint fails', async () => {
    mockSpawn.mockReturnValue(makeChild([resultEvent()]));
    mintMcpTokenMock.mockResolvedValueOnce(undefined);
    mockGetFrameworkConfig.mockReturnValueOnce({
      proxy: { baseUrl: 'https://llm.example.com/v1' },
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

    await runGeminiCliAgent(evalDef, tmpWorkspace, { tools: ['mcp'] });

    const settings = readSettings();
    expect(settings).not.toHaveProperty('mcpServers');
  });
});

// ── GH_TOKEN env forwarding ──────────────────────────────────────────────────

describe('GH_TOKEN env forwarding', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function capturedEnv(): Record<string, string> {
    const call = mockSpawn.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    return call[2].env;
  }

  it('includes GH_TOKEN when set in process.env', async () => {
    vi.stubEnv('GH_TOKEN', 'gh-test-token-456');
    mockSpawn.mockReturnValue(makeChild([resultEvent()]));

    await runGeminiCliAgent(evalDef, workspace);
    expect(capturedEnv().GH_TOKEN).toBe('gh-test-token-456');
  });

  it('omits GH_TOKEN when not set in process.env', async () => {
    vi.stubEnv('GH_TOKEN', '');
    mockSpawn.mockReturnValue(makeChild([resultEvent()]));

    await runGeminiCliAgent(evalDef, workspace);
    expect(capturedEnv()).not.toHaveProperty('GH_TOKEN');
  });
});
