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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// ── Mock spawn ────────────────────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

// Prevent actual OCM subprocess calls from proxy helpers.
vi.mock('../src/agent_eval/runners/gemini-cli/proxy.js', () => ({
  geminiProxyEnv: vi.fn().mockReturnValue({}),
}));

import { runGeminiCliAgent } from '../src/agent_eval/runners/gemini-cli/agent.js';

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
    expect(tc.name).toBe('read');
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

  it.each([
    ['read_file', 'read'],
    ['write_file', 'write'],
    ['edit_file', 'edit'],
    ['replace_in_file', 'edit'],
    ['run_shell_command', 'bash'],
    ['list_directory', 'bash'],
    ['create_directory', 'bash'],
    ['glob', 'glob'],
    ['grep', 'grep'],
    ['web_fetch', 'webfetch'],
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

  it('mcp_-prefixed tool is mapped to "mcp" and classified as doc lookup', async () => {
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
    expect(record.toolCalls[0].name).toBe('mcp');
    expect(record.toolCalls[0].isDocLookup).toBe(true);
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
