/**
 * Unit tests for runOpencodeAgent in opencode/agent.ts.
 *
 * Mocks `node:child_process` spawn so the tests never touch the filesystem or
 * spawn a real process.  Each test builds a fake child that emits JSONL events
 * via a Readable stdout, then asserts on the returned RunRecord.
 *
 * Covered scenarios:
 *   - tool_use + tool_result  → ToolCallRecord with translator-mapped name
 *   - step_finish             → TurnMetric; token / cost accumulation
 *   - text / message          → finalSummary
 *   - error event             → providerErrors
 *   - malformed (non-JSON) line → skipped; run still finalises as success
 *   - MAX_TURNS enforcement   → status=failure; child.kill called
 *   - orphaned tool_use       → drained on close with causedError=true
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// ── Mock framework config ─────────────────────────────────────────────────────

const mockGetFrameworkConfig = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    proxy: { baseUrl: 'https://llm.example.com' },
    mcp: {
      servers: {
        'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
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

// ── Mock spawn ────────────────────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

// ── Mock binary resolution so resolveOpencodeBin() doesn't throw ──────────────

vi.mock('node:module', async () => {
  const actual = await vi.importActual<typeof import('node:module')>('node:module');
  return {
    ...actual,
    createRequire: vi.fn().mockReturnValue(
      Object.assign(vi.fn().mockReturnValue(undefined), {
        resolve: vi.fn().mockReturnValue('/mock/opencode-ai/package.json'),
        extensions: {},
        cache: {},
        main: undefined,
      }),
    ),
  };
});

// ── Mock fs so writeOpencodeConfig doesn't touch the real filesystem ───────────

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, writeFileSync: vi.fn() };
});

import { MAX_TURNS } from '@a0/evals-core';
import { runOpencodeAgent } from '../../src/runners/opencode/agent.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type JsonlEvent = Record<string, unknown>;

/**
 * Builds a fake child process.  `events` are pushed as JSONL lines then the
 * stream ends; the `close` event fires with `exitCode`.  All of this happens
 * inside a `setImmediate` so readline has time to attach before data arrives.
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

/**
 * Build a child that pushes raw text lines (for testing malformed input).
 */
function makeChildWithRawLines(lines: string[], exitCode = 0) {
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
    for (const line of lines) {
      stdout.push(line + '\n');
    }
    stdout.push(null);
    stderr.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

const evalDef = { id: 'react_quickstart', userPrompt: 'Add Auth0 login.' };
const workspace = '/tmp/test-workspace';

beforeEach(() => {
  mockSpawn.mockReset();
  mintMcpTokenMock.mockReset();
});

// ── tool_use + tool_result ────────────────────────────────────────────────────

describe('tool_use + tool_result', () => {
  it('creates a ToolCallRecord with translator-mapped name, normalized args, and causedError=false', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool_use',
          tool_id: 't1',
          tool_name: 'bash',
          parameters: { command: 'npm install' },
        },
        {
          type: 'tool_result',
          tool_id: 't1',
          output: 'added 10 packages',
          status: 'success',
        },
        // Provide a step_finish so status resolves to success
        {
          type: 'step_finish',
          tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.0001,
        },
        { type: 'text', content: 'Done.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    const tc = record.toolCalls[0];

    // opencode 'bash' → canonical 'run_command'
    expect(tc.name).toBe('run_command');
    // args are normalised by the translator
    expect(tc.args).toEqual({ command: 'npm install' });
    expect(tc.result).toBe('added 10 packages');
    expect(tc.causedError).toBe(false);
    // actionType must be set (non-empty string)
    expect(typeof tc.actionType).toBe('string');
    expect(tc.actionType.length).toBeGreaterThan(0);
  });

  it('accepts the hyphenated spelling tool-use as equivalent to tool_use', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool-use',
          tool_id: 't2',
          tool_name: 'bash',
          parameters: { command: 'ls' },
        },
        {
          type: 'tool_result',
          tool_id: 't2',
          output: 'src/',
          status: 'success',
        },
        {
          type: 'step_finish',
          tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'Done.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('run_command');
  });

  it('marks tool_result with status error as causedError=true', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool_use',
          tool_id: 't3',
          tool_name: 'bash',
          parameters: { command: 'npm test' },
        },
        {
          type: 'tool_result',
          tool_id: 't3',
          output: 'Tests failed',
          status: 'error',
        },
        {
          type: 'step_finish',
          tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'Failed.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
  });

  it('marks tool_result with is_error=true as causedError=true', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool_use',
          tool_id: 't4',
          tool_name: 'read',
          parameters: { filePath: 'src/app.ts' },
        },
        {
          type: 'tool_result',
          tool_id: 't4',
          output: 'ENOENT',
          is_error: true,
        },
        {
          type: 'step_finish',
          tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'Failed.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
  });
});

// ── step_finish: token accumulation and TurnMetric ───────────────────────────

describe('step_finish events', () => {
  it('accumulates inputTokens/outputTokens and pushes a TurnMetric', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step_finish',
          tokens: { input: 100, output: 40, reasoning: 10, cache: { read: 20, write: 5 } },
          cost: 0.0025,
        },
        { type: 'text', content: 'All done.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);

    // inputTokens = input(100) + cache.read(20) = 120
    expect(record.inputTokens).toBe(120);
    // outputTokens = output(40) + reasoning(10) + cache.write(5) = 55
    expect(record.outputTokens).toBe(55);

    // costUsd prefers the reported cost
    expect(record.costUsd).toBeCloseTo(0.0025);

    expect(record.turnMetrics).toHaveLength(1);
    const tm = record.turnMetrics[0];
    expect(tm.turn).toBe(1);
    expect(tm.inputTokens).toBe(120);
    expect(tm.outputTokens).toBe(55);
    expect(tm.costUsd).toBeCloseTo(0.0025);
    expect(typeof tm.llmLatency).toBe('number');
    expect(tm.llmLatency).toBeGreaterThanOrEqual(0);
  });

  it('accepts the hyphenated spelling step-finish', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step-finish',
          tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.001,
        },
        { type: 'text', content: 'Done.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.inputTokens).toBe(50);
  });

  it('accumulates tokens across multiple step_finish events', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step_finish',
          tokens: { input: 100, output: 30, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.001,
        },
        {
          type: 'step_finish',
          tokens: { input: 200, output: 60, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.002,
        },
        { type: 'text', content: 'Done.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.inputTokens).toBe(300);
    expect(record.outputTokens).toBe(90);
    expect(record.costUsd).toBeCloseTo(0.003);
    expect(record.turnMetrics).toHaveLength(2);
    expect(record.turnMetrics[0].turn).toBe(1);
    expect(record.turnMetrics[1].turn).toBe(2);
  });

  it('uses estimated cost when reported cost is 0 or absent', async () => {
    // estimateCost is mocked to return 0, so we just verify costUsd stays 0 in that path
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step_finish',
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          // cost intentionally absent
        },
        { type: 'text', content: 'Done.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    // estimateCost mock returns 0 → costUsd should be 0
    expect(record.costUsd).toBe(0);
  });

  it('step_finish with no tool calls in the turn has finishReason stop', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step_finish',
          tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'No tools used.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
    expect(record.turnMetrics[0].toolCallCount).toBe(0);
  });

  it('step_finish after tool calls has finishReason tool_calls', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool_use',
          tool_id: 'ta',
          tool_name: 'bash',
          parameters: { command: 'ls' },
        },
        {
          type: 'tool_result',
          tool_id: 'ta',
          output: 'src/',
          status: 'success',
        },
        {
          type: 'step_finish',
          tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'Done.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.turnMetrics[0].finishReason).toBe('tool_calls');
    expect(record.turnMetrics[0].toolCallCount).toBe(1);
  });
});

// ── text / message events → finalSummary ─────────────────────────────────────

describe('text / message events', () => {
  it('text event sets finalSummary', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step_finish',
          tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'Integration complete.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Integration complete.');
  });

  it('last text event wins as finalSummary', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'text', content: 'First message.' },
        {
          type: 'step_finish',
          tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'Final summary.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Final summary.');
  });

  it('message event sets finalSummary via .content field', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step_finish',
          tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'message', content: 'Message content.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Message content.');
  });

  it('assistant_message event sets finalSummary', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step_finish',
          tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'assistant_message', content: 'Assistant reply.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Assistant reply.');
  });
});

// ── error events ──────────────────────────────────────────────────────────────

describe('error events', () => {
  it('error event with message field is appended to providerErrors', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'error', message: 'rate limit exceeded' },
        { type: 'text', content: 'Stopped.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.providerErrors.some((e) => e.includes('rate limit exceeded'))).toBe(true);
  });

  it('error event with error field is appended to providerErrors', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        { type: 'error', error: 'connection reset' },
        { type: 'text', content: 'Stopped.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.providerErrors.some((e) => e.includes('connection reset'))).toBe(true);
  });
});

// ── malformed (non-JSON) lines ────────────────────────────────────────────────

describe('malformed stdout lines', () => {
  it('skips non-JSON lines without throwing; run finalizes as success when valid output exists', async () => {
    // Interleave some garbage with a valid step_finish + text event
    const lines = [
      'not valid json at all',
      JSON.stringify({
        type: 'step_finish',
        tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
      '{ bad json',
      JSON.stringify({ type: 'text', content: 'Done.' }),
    ];

    const child = makeChildWithRawLines(lines, 0);
    mockSpawn.mockReturnValue(child);

    const record = await runOpencodeAgent(evalDef, workspace);
    // No throw; record is still valid
    expect(record.status).toBe('success');
    expect(record.finalSummary).toBe('Done.');
    expect(record.turnMetrics).toHaveLength(1);
  });

  it('skips empty/whitespace lines without affecting the run', async () => {
    const lines = [
      '   ',
      '',
      JSON.stringify({ type: 'text', content: 'Hello.' }),
      JSON.stringify({
        type: 'step_finish',
        tokens: { input: 2, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ];

    mockSpawn.mockReturnValue(makeChildWithRawLines(lines, 0));
    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.status).toBe('success');
  });
});

// ── MAX_TURNS enforcement ─────────────────────────────────────────────────────

describe('MAX_TURNS enforcement', () => {
  it('sets status=failure and calls child.kill after MAX_TURNS step_finish events', async () => {
    const events: JsonlEvent[] = [];
    for (let i = 0; i < MAX_TURNS + 3; i++) {
      events.push({
        type: 'tool_use',
        tool_id: `t${i}`,
        tool_name: 'bash',
        parameters: { command: 'ls' },
      });
      events.push({
        type: 'tool_result',
        tool_id: `t${i}`,
        output: 'ok',
        status: 'success',
      });
      events.push({
        type: 'step_finish',
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.001,
      });
    }
    events.push({ type: 'text', content: 'Went on too long.' });

    const child = makeChild(events);
    mockSpawn.mockReturnValue(child);

    const record = await runOpencodeAgent(evalDef, workspace);

    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('turn limit'))).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    // At least MAX_TURNS turn metrics should exist
    expect(record.turnMetrics.length).toBeGreaterThanOrEqual(MAX_TURNS);
  });
});

// ── orphaned tool_use (no matching tool_result) ───────────────────────────────

describe('orphaned tool_use events', () => {
  it('drains orphaned tool_use into a ToolCallRecord with causedError=true before close', async () => {
    // Emit a tool_use that never receives a tool_result, then close.
    mockSpawn.mockReturnValue(
      makeChild(
        [
          {
            type: 'tool_use',
            tool_id: 'orphan1',
            tool_name: 'bash',
            parameters: { command: 'rm -rf /' },
          },
        ],
        1,
      ),
    );

    const record = await runOpencodeAgent(evalDef, workspace);

    const orphaned = record.toolCalls.find((tc) => tc.name === 'run_command');
    expect(orphaned).toBeDefined();
    expect(orphaned?.causedError).toBe(true);
    expect(orphaned?.result).toBe('');
    expect(record.providerErrors.some((e) => e.includes('orphaned tool call'))).toBe(true);
  });

  it('drains multiple orphaned tool_use events', async () => {
    mockSpawn.mockReturnValue(
      makeChild(
        [
          { type: 'tool_use', tool_id: 'o1', tool_name: 'bash', parameters: { command: 'ls' } },
          { type: 'tool_use', tool_id: 'o2', tool_name: 'read', parameters: { filePath: 'app.ts' } },
        ],
        1,
      ),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(2);
    expect(record.toolCalls.every((tc) => tc.causedError)).toBe(true);
    expect(record.providerErrors.filter((e) => e.startsWith('orphaned tool call:'))).toHaveLength(2);
  });
});

// ── status and final state ────────────────────────────────────────────────────

describe('status and final state', () => {
  it('clean close with finalSummary and tool calls sets status=success', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'tool_use',
          tool_id: 't1',
          tool_name: 'bash',
          parameters: { command: 'npm install' },
        },
        {
          type: 'tool_result',
          tool_id: 't1',
          output: 'ok',
          status: 'success',
        },
        {
          type: 'step_finish',
          tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'Task complete.' },
      ]),
    );

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.status).toBe('success');
  });

  it('non-zero exit with no output sets status=failure', async () => {
    mockSpawn.mockReturnValue(makeChild([], 1, 'fatal error'));
    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
  });

  it('spawn error event sets status=failure', async () => {
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

    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('spawn ENOENT'))).toBe(true);
  });

  it('endTime is always set after completion', async () => {
    mockSpawn.mockReturnValue(makeChild([], 1));
    const before = Date.now() / 1000;
    const record = await runOpencodeAgent(evalDef, workspace);
    const after = Date.now() / 1000;
    expect(record.endTime).toBeGreaterThanOrEqual(before);
    expect(record.endTime).toBeLessThanOrEqual(after + 0.1);
  });

  it('record taskName is the eval id', async () => {
    mockSpawn.mockReturnValue(
      makeChild([
        {
          type: 'step_finish',
          tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        { type: 'text', content: 'Done.' },
      ]),
    );
    const record = await runOpencodeAgent(evalDef, workspace);
    expect(record.taskName).toBe('react_quickstart');
  });
});
