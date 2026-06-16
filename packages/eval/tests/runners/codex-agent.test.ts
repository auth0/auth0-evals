/**
 * Unit tests for runCodexAgent in codex/agent.ts.
 *
 * Mocks `@openai/codex-sdk` so that `Codex` → `startThread`/`resumeThread` →
 * `runStreamed` returns `{ events: asyncGenerator }`, emitting typed ThreadEvents.
 * Verifies that RunRecord fields (toolCalls, turnMetrics, status, finalSummary,
 * etc.) are populated correctly for the common event sequences:
 *
 *   - item.completed[command_execution] → run_command ToolCallRecord
 *   - item.completed[file_change]       → write_file (add/update); delete → run_command (rm <path>)
 *   - item.completed[mcp_tool_call]     → mcp__ ToolCallRecord
 *   - item.completed[agent_message]     → finalSummary
 *   - turn.completed                    → TurnMetric with token counts
 *   - turn limit reached                → abort + failure
 *   - SDK generator throw               → provider error + failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs to avoid touching the filesystem ─────────────────────────────────

// In-memory file contents the mocked readFileSync serves. Keyed by absolute path.
const fakeFiles = vi.hoisted(() => new Map<string, string>());

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    realpathSync: vi.fn((p: string) => p),
    readFileSync: vi.fn((p: string) => {
      if (fakeFiles.has(p)) return fakeFiles.get(p)!;
      const err = new Error(`ENOENT: no such file '${p}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }),
  };
});

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock framework config ─────────────────────────────────────────────────────

const mockGetFrameworkConfig = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
    mcp: { servers: {} },
  }),
);

const mintMcpTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@a0/eval-core', async () => ({
  ...(await vi.importActual('@a0/eval-core')),
  getAgentProxyBaseUrl: vi.fn().mockReturnValue('https://your-llm-proxy.example.com'),
  getFrameworkConfig: mockGetFrameworkConfig,
  mintMcpToken: mintMcpTokenMock,
}));

// ── Mock @openai/codex-sdk ──────────────────────────────────────────────────

type JsonlEvent = Record<string, unknown>;

const sdk = vi.hoisted(() => {
  const state = {
    constructorCalls: [] as Array<Record<string, unknown>>,
    startThreadCalls: [] as Array<Record<string, unknown>>,
    resumeThreadCalls: [] as Array<{ id: string; options: Record<string, unknown> }>,
    // FIFO queue of event arrays — one entry consumed per runStreamed call (turn).
    turns: [] as Array<Array<Record<string, unknown>>>,
  };

  async function* gen(events: Array<Record<string, unknown>>, signal?: AbortSignal) {
    for (const ev of events) {
      if (signal?.aborted) throw new Error('aborted');
      if (ev.type === '__throw__') throw new Error((ev.message as string) ?? 'sdk error');
      yield ev;
    }
  }

  const runStreamed = (_input: string, turnOptions?: { signal?: AbortSignal }) => {
    const events = state.turns.shift() ?? [];
    return Promise.resolve({ events: gen(events, turnOptions?.signal) });
  };

  return { state, runStreamed };
});

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(options?: Record<string, unknown>) {
      sdk.state.constructorCalls.push(options ?? {});
    }
    startThread(options: Record<string, unknown>) {
      sdk.state.startThreadCalls.push(options);
      return { runStreamed: sdk.runStreamed };
    }
    resumeThread(id: string, options: Record<string, unknown>) {
      sdk.state.resumeThreadCalls.push({ id, options });
      return { runStreamed: sdk.runStreamed };
    }
  },
}));

import { MAX_TURNS } from '@a0/eval-core';
import { writeFileSync } from 'node:fs';
import { runCodexAgent } from '../../src/runners/codex/agent.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Queues the event arrays returned by successive runStreamed calls (turns). */
function queueTurns(...turns: JsonlEvent[][]): void {
  sdk.state.turns = turns.map((t) => [...t]);
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
  vi.clearAllMocks();
  sdk.state.constructorCalls = [];
  sdk.state.startThreadCalls = [];
  sdk.state.resumeThreadCalls = [];
  sdk.state.turns = [];
  fakeFiles.clear();
});

// ── thread.started ────────────────────────────────────────────────────────────

describe('thread.started event', () => {
  it('sets sessionId from thread_id', async () => {
    queueTurns([{ type: 'thread.started', thread_id: 'thread-abc-123' }, turnCompleted()]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.sessionId).toBe('thread-abc-123');
  });
});

// ── command_execution ─────────────────────────────────────────────────────────

describe('command_execution events', () => {
  it('creates ToolCallRecord for item.completed[command_execution]', async () => {
    queueTurns([
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
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    const tc = record.toolCalls[0];
    expect(tc.name).toBe('run_command');
    expect(tc.args).toEqual({ command: 'npm install' });
    expect(tc.result).toBe('added 10 packages');
    expect(tc.causedError).toBe(false);
  });

  it('marks command_execution with non-zero exit_code as causedError', async () => {
    queueTurns([
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
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
  });

  it('maps a read-only shell command to a read_file tool call', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          id: 'item_r',
          command: `/bin/zsh -lc "sed -n '1,220p' src/App.jsx"`,
          aggregated_output: 'file contents',
          exit_code: 0,
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('read_file');
    expect(record.toolCalls[0].args).toEqual({ path: 'src/App.jsx' });
  });

  it('keeps a failed read-only command as run_command (error)', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          id: 'item_re',
          command: 'cat missing.txt',
          aggregated_output: 'cat: missing.txt: No such file',
          exit_code: 1,
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].name).toBe('run_command');
    expect(record.toolCalls[0].causedError).toBe(true);
  });

  it('treats undefined exit_code as success (not error)', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'item_1', command: 'ls', aggregated_output: 'src/' },
        // exit_code intentionally omitted
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(false);
  });
});

// ── file_change ────────────────────────────────────────────────────────────────

describe('file_change events', () => {
  it('maps file_change changes to write_file / delete_file ToolCallRecords', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'file_change',
          id: 'fc_1',
          status: 'completed',
          changes: [
            { path: 'src/App.tsx', kind: 'add' },
            { path: 'src/auth.ts', kind: 'update' },
            { path: 'old.ts', kind: 'delete' },
          ],
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(3);

    const writes = record.toolCalls.filter((tc) => tc.name === 'write_file');
    expect(writes.map((w) => w.args.path).sort()).toEqual(['src/App.tsx', 'src/auth.ts']);
    expect(writes.every((w) => w.causedError === false)).toBe(true);

    // delete_file maps to run_command (rm <path>) via the translator.
    const del = record.toolCalls.find((tc) => tc.name === 'run_command');
    expect(del?.args.command).toBe('rm old.ts');

    expect(record.turnMetrics[0].toolCallCount).toBe(3);
  });

  it('marks failed file_change as causedError', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'file_change',
          id: 'fc_2',
          status: 'failed',
          changes: [{ path: 'src/App.tsx', kind: 'add' }],
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].name).toBe('write_file');
    expect(record.toolCalls[0].causedError).toBe(true);
  });

  it('captures written file content from the workspace for add/update changes', async () => {
    fakeFiles.set(`${workspace}/.env`, 'AUTH0_DOMAIN=example.auth0.com\nAUTH0_CLIENT_ID=abc123\n');
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'file_change',
          id: 'fc_3',
          status: 'completed',
          changes: [{ path: '.env', kind: 'add' }],
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    const write = record.toolCalls.find((tc) => tc.name === 'write_file');
    expect(write?.args.path).toBe('.env');
    expect(write?.args.content).toContain('AUTH0_DOMAIN=example.auth0.com');
    expect(write?.args.content).toContain('AUTH0_CLIENT_ID=abc123');
  });

  it('leaves content empty when the written file cannot be read back', async () => {
    // No entry in fakeFiles → readFileSync throws ENOENT.
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'file_change',
          id: 'fc_4',
          status: 'completed',
          changes: [{ path: 'src/App.tsx', kind: 'update' }],
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    const write = record.toolCalls.find((tc) => tc.name === 'write_file');
    expect(write?.args.path).toBe('src/App.tsx');
    expect(write?.args.content).toBe('');
  });

  it('does not read content for deleted or failed changes', async () => {
    fakeFiles.set(`${workspace}/gone.ts`, 'should not be read');
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'file_change',
          id: 'fc_5',
          status: 'failed',
          changes: [{ path: 'gone.ts', kind: 'add' }],
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    const write = record.toolCalls.find((tc) => tc.name === 'write_file');
    expect(write?.causedError).toBe(true);
    expect(write?.args.content).toBe('');
  });
});

// ── web_search ─────────────────────────────────────────────────────────────────

describe('web_search events', () => {
  it('records web_search as a doc-lookup fetch_url call', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: { type: 'web_search', id: 'ws_1', query: 'auth0 react quickstart' },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('fetch_url');
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });
});

// ── mcp_tool_call events ──────────────────────────────────────────────────────

describe('mcp_tool_call events', () => {
  it('creates ToolCallRecord with mcp__ name for item.completed[mcp_tool_call]', async () => {
    queueTurns([
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
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    const tc = record.toolCalls[0];
    expect(tc.name).toBe('mcp__auth0-docs__search_auth0_docs');
    expect(tc.causedError).toBe(false);
    expect(tc.isDocLookup).toBe(true);
  });

  it('marks mcp_tool_call with error as causedError', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          id: 'mcp_2',
          server: 'auth0-docs',
          tool: 'search_auth0_docs',
          arguments: {},
          result: null,
          error: { message: 'server unavailable' },
          status: 'failed',
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.toolCalls[0].causedError).toBe(true);
    expect(record.toolCalls[0].result).toContain('server unavailable');
  });

  it('counts mcp_tool_call in turnMetrics toolCallCount', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          id: 'mcp_4',
          server: 'auth0-docs',
          tool: 'search_auth0_docs',
          arguments: {},
          result: 'results',
          error: null,
          status: 'completed',
        },
      },
      turnCompleted({ input_tokens: 50, output_tokens: 20 }),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.turnMetrics[0].toolCallCount).toBe(1);
    expect(record.turnMetrics[0].finishReason).toBe('tool_calls');
  });
});

// ── turn metrics ──────────────────────────────────────────────────────────────

describe('turn metrics', () => {
  it('turn.completed creates TurnMetric with token counts', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'i1', command: 'ls', aggregated_output: 'src/', exit_code: 0 },
      },
      turnCompleted({ input_tokens: 100, output_tokens: 50 }),
    ]);

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
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
    expect(record.turnMetrics[0].toolCallCount).toBe(0);
  });

  it('accumulates tokens across multiple turns', async () => {
    queueTurns([
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'i1', command: 'ls', aggregated_output: '', exit_code: 0 },
      },
      turnCompleted({ input_tokens: 100, output_tokens: 30 }),
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'i2', command: 'cat', aggregated_output: '', exit_code: 0 },
      },
      turnCompleted({ input_tokens: 200, output_tokens: 40 }),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.turnMetrics).toHaveLength(2);
    expect(record.inputTokens).toBe(300);
    expect(record.outputTokens).toBe(70);
  });
});

// ── tool-call timing ──────────────────────────────────────────────────────────

describe('tool-call timing', () => {
  it('records active duration from item.started, not from item.completed', async () => {
    // Advance Date.now() by 1s per read. With the fix, the timed_1 tool call's
    // startTime is captured at its item.started event, so intervening reads
    // (other items completing between started and completed) make its duration
    // several seconds. The old code read startTime inside item.completed, giving
    // a ~1-tick duration regardless — so Setup Speed was meaningless for Codex.
    let clock = 1_000_000; // ms
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      const v = clock;
      clock += 1_000; // advance 1s per read
      return v;
    });

    queueTurns([
      // timed_1 starts here...
      { type: 'item.started', item: { type: 'command_execution', id: 'timed_1', command: 'npm install' } },
      // ...several other items complete before timed_1 does (advancing the clock).
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'other_a', command: 'ls', aggregated_output: '', exit_code: 0 },
      },
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'other_b', command: 'pwd', aggregated_output: '', exit_code: 0 },
      },
      // ...and only now does timed_1 complete.
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          id: 'timed_1',
          command: 'npm install',
          aggregated_output: 'ok',
          exit_code: 0,
        },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    nowSpy.mockRestore();

    const timed = record.toolCalls.find((tc) => tc.args.command === 'npm install')!;
    // Fixed: startTime is from item.started, several reads before completion → ≥ 2s.
    // Buggy: startTime read inside item.completed → ~1s.
    expect(timed.endTime - timed.startTime).toBeGreaterThanOrEqual(2);
  });

  it('falls back to a non-negative duration when item.started was not seen', async () => {
    // No item.started for this id — startTime must not exceed endTime.
    queueTurns([
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'no_start', command: 'ls', aggregated_output: '', exit_code: 0 },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    const tc = record.toolCalls[0];
    expect(tc.endTime).toBeGreaterThanOrEqual(tc.startTime);
  });
});

// ── finalSummary ──────────────────────────────────────────────────────────────

describe('finalSummary', () => {
  it('sets finalSummary from item.completed[agent_message]', async () => {
    queueTurns([
      { type: 'item.completed', item: { type: 'agent_message', text: 'Auth0 integration complete.' } },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.finalSummary).toBe('Auth0 integration complete.');
  });
});

// ── status and final state ────────────────────────────────────────────────────

describe('status and final state', () => {
  it('successful run sets status success', async () => {
    queueTurns([
      { type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } },
      turnCompleted({ input_tokens: 100, output_tokens: 20 }),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.status).toBe('success');
  });

  it('SDK generator throw sets status to failure', async () => {
    queueTurns([{ type: '__throw__', message: 'spawn ENOENT' }]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('spawn ENOENT'))).toBe(true);
  });

  it('turn.failed adds to providerErrors', async () => {
    queueTurns([{ type: 'turn.failed', error: { message: 'rate limit exceeded' } }]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.providerErrors.some((e) => e.includes('rate limit exceeded'))).toBe(true);
  });

  it('item.completed[error] pushes to providerErrors', async () => {
    queueTurns([
      { type: 'item.completed', item: { type: 'error', message: 'sandbox initialization failed' } },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.providerErrors).toContain('sandbox initialization failed');
  });

  it('top-level error event pushes to providerErrors', async () => {
    queueTurns([{ type: 'error', message: 'connection reset' }]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.providerErrors).toContain('connection reset');
  });

  it('aborts and fails when MAX_TURNS is reached', async () => {
    const events: JsonlEvent[] = [];
    for (let i = 0; i < MAX_TURNS + 2; i++) {
      events.push({
        type: 'item.completed',
        item: { type: 'command_execution', id: `i${i}`, command: 'ls', aggregated_output: '', exit_code: 0 },
      });
      events.push(turnCompleted());
    }
    queueTurns(events);

    const record = await runCodexAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('turn limit'))).toBe(true);
    expect(record.turnMetrics.length).toBe(MAX_TURNS);
  });

  it('endTime is always set after completion', async () => {
    queueTurns([]);

    const before = Date.now() / 1000;
    const record = await runCodexAgent(evalDef, workspace);
    const after = Date.now() / 1000;

    expect(record.endTime).toBeGreaterThanOrEqual(before);
    expect(record.endTime).toBeLessThanOrEqual(after + 0.1);
  });
});

// ── resume nudge loop ─────────────────────────────────────────────────────────

describe('resume nudge loop', () => {
  it('resumes with a nudge when the first turn is text-only', async () => {
    queueTurns(
      // Turn 1: text-only planning message (0 tool calls).
      [
        { type: 'thread.started', thread_id: 'thread-resume-1' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Let me plan...' } },
        turnCompleted({ input_tokens: 50, output_tokens: 30 }),
      ],
      // Turn 2 (resume): an actual tool call.
      [
        {
          type: 'item.completed',
          item: { type: 'command_execution', id: 'i1', command: 'npm install', aggregated_output: 'ok', exit_code: 0 },
        },
        turnCompleted({ input_tokens: 100, output_tokens: 50 }),
      ],
    );

    const record = await runCodexAgent(evalDef, workspace);
    expect(sdk.state.resumeThreadCalls).toHaveLength(1);
    expect(sdk.state.resumeThreadCalls[0].id).toBe('thread-resume-1');
    expect(record.toolCalls).toHaveLength(1);
    expect(record.status).toBe('success');
  });

  it('does not resume when the first turn already used a tool', async () => {
    queueTurns([
      { type: 'thread.started', thread_id: 'thread-no-resume' },
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'i1', command: 'npm install', aggregated_output: 'ok', exit_code: 0 },
      },
      turnCompleted(),
    ]);

    const record = await runCodexAgent(evalDef, workspace);
    expect(sdk.state.resumeThreadCalls).toHaveLength(0);
    expect(record.status).toBe('success');
  });
});

// ── thread options ────────────────────────────────────────────────────────────

describe('thread options', () => {
  it('starts the thread with sandbox, cwd, and model options', async () => {
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

    await runCodexAgent(evalDef, workspace, { model: 'gpt-5.4' });

    expect(sdk.state.startThreadCalls).toHaveLength(1);
    const opts = sdk.state.startThreadCalls[0];
    expect(opts.model).toBe('gpt-5.4');
    expect(opts.workingDirectory).toBe(workspace);
    expect(opts.sandboxMode).toBe('danger-full-access');
    expect(opts.skipGitRepoCheck).toBe(true);
    expect(opts.approvalPolicy).toBe('never');
  });
});

// ── MCP integration ───────────────────────────────────────────────────────────

describe('MCP integration', () => {
  beforeEach(() => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
      mcp: { servers: {} },
    });
  });

  it('writes http MCP server block to config.toml', async () => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
      mcp: {
        servers: {
          'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
        },
      },
    });
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

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
      proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
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
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

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

  it('injects stdio MCP server env vars into the Codex env', async () => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
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
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

    await runCodexAgent(evalDef, workspace, { tools: ['mcp'] });

    const codexOptions = sdk.state.constructorCalls[0];
    const env = codexOptions.env as Record<string, string>;
    expect(env['MY_SECRET_TOKEN']).toBe('secret123');
  });

  it('mints a token and writes bearer_token_env_var for authed http servers', async () => {
    mintMcpTokenMock.mockResolvedValueOnce('minted-token');
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
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
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

    await runCodexAgent(evalDef, workspace, { tools: ['mcp'] });

    const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).endsWith('config.toml'),
    );
    expect(written).toBeDefined();
    if (!written) return;
    const toml = written[1] as string;
    expect(toml).toContain('[mcp_servers."auth0-hosted-mcp"]');
    expect(toml).toContain('url = "https://tenant.auth0.com/v1/mcp"');
    expect(toml).toContain('bearer_token_env_var = "MCP_BEARER_AUTH0_HOSTED_MCP"');
    // The token itself must never be written to the config file.
    expect(toml).not.toContain('minted-token');

    // The minted token is injected into the Codex env under the referenced name.
    const codexOptions = sdk.state.constructorCalls[0];
    const env = codexOptions.env as Record<string, string>;
    expect(env['MCP_BEARER_AUTH0_HOSTED_MCP']).toBe('minted-token');
  });

  it('skips an authed server when the token mint fails', async () => {
    mintMcpTokenMock.mockResolvedValueOnce(undefined);
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
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
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

    await runCodexAgent(evalDef, workspace, { tools: ['mcp'] });

    const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).endsWith('config.toml'),
    );
    expect(written).toBeDefined();
    if (!written) return;
    const toml = written[1] as string;
    expect(toml).not.toContain('auth0-hosted-mcp');
  });

  it('does not write MCP sections when tools does not include mcp', async () => {
    mockGetFrameworkConfig.mockReturnValue({
      proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },
      mcp: {
        servers: {
          'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
        },
      },
    });
    queueTurns([{ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }, turnCompleted()]);

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
