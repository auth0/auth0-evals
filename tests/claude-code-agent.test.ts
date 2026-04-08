/**
 * Unit tests for handleEvent and normaliseStopReason in claude-code-agent.ts.
 *
 * handleEvent is pure data transformation — it takes a stream-json event and
 * mutates a RunRecord / pending map.  No subprocess, no filesystem, no mocking required.
 */

import { describe, it, expect } from 'vitest';
import { ClaudeCodeTranslator } from '../src/agent_eval/tool-translator.js';
import {
  handleEvent,
  normaliseStopReason,
  processStreamChunk,
  CLAUDE_CODE_MODEL_ID,
  type StreamState,
  type TurnStateUpdate,
  type ProcessingContext,
  type CcSystemEvent,
  type CcContentText,
  type CcContentToolUse,
  type CcAssistantEvent,
  type CcToolResultContent,
  type CcUserEvent,
  type CcResultEvent,
} from '../src/agent_eval/runners/claude-code/agent.js';
import type { RunRecord } from '../src/agent_eval/agent-types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(): RunRecord {
  return {
    taskName: 'test_task',
    model: CLAUDE_CODE_MODEL_ID,
    sessionId: '',
    startTime: 0,
    endTime: 0,
    toolCalls: [],
    turnMetrics: [],
    providerErrors: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    status: 'running',
    finalSummary: '',
    workspace: '/tmp/test',
  };
}

type PendingMap = Map<string, { name: string; input: Record<string, unknown>; startTime: number }>;

function makePending(
  entries: Array<[string, { name: string; input: Record<string, unknown>; startTime: number }]> = [],
): PendingMap {
  return new Map(entries);
}

function makeAssistantEv(
  overrides: {
    content?: (CcContentText | CcContentToolUse)[];
    stop_reason?: string | null;
    input_tokens?: number;
    output_tokens?: number;
  } = {},
): CcAssistantEvent {
  return {
    type: 'assistant',
    message: {
      id: 'msg_1',
      role: 'assistant',
      content: overrides.content ?? [],
      model: 'claude-sonnet',
      stop_reason: overrides.stop_reason !== undefined ? overrides.stop_reason : null,
      usage: {
        input_tokens: overrides.input_tokens ?? 10,
        output_tokens: overrides.output_tokens ?? 5,
      },
    },
  };
}

function makeUserEv(blocks: CcToolResultContent[]): CcUserEvent {
  return { type: 'user', message: { role: 'user', content: blocks } };
}

function makeResultEv(
  overrides: {
    subtype?: CcResultEvent['subtype'];
    result?: string;
    total_cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
  } = {},
): CcResultEvent {
  const subtype = overrides.subtype ?? 'success';
  return {
    type: 'result',
    subtype,
    is_error: subtype !== 'success',
    result: overrides.result ?? '',
    session_id: 'sess_1',
    total_cost_usd: overrides.total_cost_usd ?? 0.05,
    duration_ms: 5000,
    num_turns: 3,
    usage: {
      input_tokens: overrides.input_tokens ?? 500,
      output_tokens: overrides.output_tokens ?? 200,
    },
  };
}

// ── normaliseStopReason ───────────────────────────────────────────────────────

describe('normaliseStopReason', () => {
  it('maps tool_use → tool_calls', () => {
    expect(normaliseStopReason('tool_use')).toBe('tool_calls');
  });

  it('maps end_turn → stop', () => {
    expect(normaliseStopReason('end_turn')).toBe('stop');
  });

  it('maps max_tokens → max_tokens', () => {
    expect(normaliseStopReason('max_tokens')).toBe('max_tokens');
  });

  it('maps stop_sequence → stop', () => {
    expect(normaliseStopReason('stop_sequence')).toBe('stop');
  });

  it('maps unknown value → unknown', () => {
    expect(normaliseStopReason('some_future_reason')).toBe('unknown');
    expect(normaliseStopReason('')).toBe('unknown');
  });
});

// ── handleEvent — system ──────────────────────────────────────────────────────

describe('handleEvent — system', () => {
  it('init event enriches model and sets sessionId', () => {
    const record = makeRecord();
    const ev: CcSystemEvent = {
      type: 'system',
      subtype: 'init',
      session_id: 'sess_abc',
      model: 'claude-sonnet-4-5',
      cwd: '/tmp',
    };
    const result = handleEvent(ev, record, makePending(), 0, 0);
    expect(result).toBeNull();
    expect(record.model).toBe('claude-code/claude-sonnet-4-5');
    expect(record.sessionId).toBe('sess_abc');
  });

  it('init with empty model falls back to CLAUDE_CODE_MODEL_ID', () => {
    const record = makeRecord();
    const ev: CcSystemEvent = { type: 'system', subtype: 'init', session_id: 'sess_xyz', model: '', cwd: '/tmp' };
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.model).toBe(CLAUDE_CODE_MODEL_ID);
  });

  it('non-init subtype returns null without mutating record', () => {
    const record = makeRecord();
    const before = { ...record };
    const ev: CcSystemEvent = {
      type: 'system',
      subtype: 'hook_response',
      session_id: 'sess_1',
      model: 'x',
      cwd: '/tmp',
    };
    const result = handleEvent(ev, record, makePending(), 0, 0);
    expect(result).toBeNull();
    expect(record.model).toBe(before.model);
    expect(record.sessionId).toBe(before.sessionId);
  });
});

// ── handleEvent — assistant ───────────────────────────────────────────────────

describe('handleEvent — assistant', () => {
  it('accumulates tokens into record', () => {
    const record = makeRecord();
    record.inputTokens = 100;
    record.outputTokens = 50;
    handleEvent(makeAssistantEv({ input_tokens: 20, output_tokens: 8 }), record, makePending(), 0, 0);
    expect(record.inputTokens).toBe(120);
    expect(record.outputTokens).toBe(58);
  });

  it('registers tool_use blocks into the pending map', () => {
    const record = makeRecord();
    const pending = makePending();
    const ev = makeAssistantEv({
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'src/index.ts' } },
        { type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'npm test' } },
      ],
    });
    handleEvent(ev, record, pending, 0, 0);
    expect(pending.has('tu_1')).toBe(true);
    expect(pending.get('tu_1')?.name).toBe('Read');
    expect(pending.has('tu_2')).toBe(true);
    expect(pending.get('tu_2')?.name).toBe('Bash');
  });

  it('with tool_use content → TurnMetric finishReason is tool_calls', () => {
    const record = makeRecord();
    const ev = makeAssistantEv({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }],
    });
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.turnMetrics[0].finishReason).toBe('tool_calls');
    expect(record.turnMetrics[0].toolCallCount).toBe(1);
  });

  it('without tool_use content → TurnMetric finishReason is stop', () => {
    const record = makeRecord();
    const ev = makeAssistantEv({ content: [{ type: 'text', text: 'Done.' }] });
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
    expect(record.turnMetrics[0].toolCallCount).toBe(0);
  });

  it('sets finalSummary from text content when stop_reason is end_turn', () => {
    const record = makeRecord();
    const ev = makeAssistantEv({
      content: [{ type: 'text', text: 'Integration complete.' }],
      stop_reason: 'end_turn',
    });
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.finalSummary).toBe('Integration complete.');
  });

  it('does not overwrite existing finalSummary with empty text', () => {
    const record = makeRecord();
    record.finalSummary = 'Previous summary.';
    const ev = makeAssistantEv({ content: [], stop_reason: 'end_turn' });
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.finalSummary).toBe('Previous summary.');
  });

  it('stop_reason null with no tool_use → derives end_turn → finishReason stop', () => {
    const record = makeRecord();
    const ev = makeAssistantEv({ content: [{ type: 'text', text: 'All done.' }], stop_reason: null });
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
  });

  it('stop_reason null with tool_use → derives tool_use → finishReason tool_calls', () => {
    const record = makeRecord();
    const ev = makeAssistantEv({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }],
      stop_reason: null,
    });
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.turnMetrics[0].finishReason).toBe('tool_calls');
  });

  it('returns TurnStateUpdate with incremented turnNum', () => {
    const record = makeRecord();
    const result = handleEvent(makeAssistantEv(), record, makePending(), 3, 0) as TurnStateUpdate;
    expect(result).not.toBeNull();
    expect(result.turnNum).toBe(4);
  });

  it('TurnMetric records the incremented turn number', () => {
    const record = makeRecord();
    handleEvent(makeAssistantEv({ input_tokens: 10, output_tokens: 5 }), record, makePending(), 2, 0);
    expect(record.turnMetrics[0].turn).toBe(3);
    expect(record.turnMetrics[0].inputTokens).toBe(10);
    expect(record.turnMetrics[0].outputTokens).toBe(5);
  });
});

// ── handleEvent — user ────────────────────────────────────────────────────────

describe('handleEvent — user', () => {
  function makePendingWithEntry(id: string, name: string, input: Record<string, unknown> = {}): PendingMap {
    return makePending([[id, { name, input, startTime: Date.now() / 1000 - 0.1 }]]);
  }

  it('resolves pending tool and creates ToolCallRecord', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'Read', { file_path: 'src/app.ts' });
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents', is_error: false }]);
    handleEvent(ev, record, pending, 1, 0);
    expect(pending.has('tu_1')).toBe(false); // consumed
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('read_file'); // Read → read_file
    expect(record.toolCalls[0].result).toBe('file contents');
    expect(record.toolCalls[0].causedError).toBe(false);
  });

  it('maps Claude Code tool names to internal taxonomy', () => {
    const cases: Array<[string, string]> = [
      ['Bash', 'run_command'],
      ['Write', 'write_file'],
      ['Edit', 'write_file'],
      ['MultiEdit', 'write_file'],
      ['Glob', 'list_files'],
      ['Grep', 'list_files'],
      ['LS', 'list_files'],
      ['WebFetch', 'fetch_url'],
      ['WebSearch', 'fetch_url'],
      ['AskUserQuestion', 'ask_user'],
    ];

    for (const [ccName, expectedName] of cases) {
      const r = makeRecord();
      const id = `tu_${ccName}`;
      const pending = makePendingWithEntry(id, ccName, {});
      const ev = makeUserEv([{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: false }]);
      handleEvent(ev, r, pending, 0, 0);
      expect(r.toolCalls[0].name).toBe(expectedName);
    }
  });

  it('unknown tool name falls back to lowercase', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'SomeFutureTool', {});
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'result', is_error: false }]);
    handleEvent(ev, record, pending, 0, 0);
    expect(record.toolCalls[0].name).toBe('somefuturetool');
  });

  it('is_error=true sets causedError, errorCategory, and pushes to providerErrors', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'Bash', { command: 'npm test' });
    const ev = makeUserEv([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'permission denied: cannot write', is_error: true },
    ]);
    handleEvent(ev, record, pending, 0, 0);
    const tc = record.toolCalls[0];
    expect(tc.causedError).toBe(true);
    expect(tc.errorCategory).toBe('permission');
    expect(record.providerErrors.some((e) => e.includes('run_command'))).toBe(true);
  });

  it('is_error=false does not push to providerErrors', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'Read', { file_path: 'index.ts' });
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'content', is_error: false }]);
    handleEvent(ev, record, pending, 0, 0);
    expect(record.providerErrors).toHaveLength(0);
  });

  it('orphaned tool_use_id (not in pending) is skipped', () => {
    const record = makeRecord();
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'unknown_id', content: 'x', is_error: false }]);
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.toolCalls).toHaveLength(0);
  });

  it('internal tool (TodoWrite) is skipped and not added to toolCalls', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'TodoWrite', { todos: [] });
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }]);
    handleEvent(ev, record, pending, 0, 0);
    expect(record.toolCalls).toHaveLength(0);
  });

  it('other internal tools are also skipped (Task, TaskOutput, ExitPlanMode)', () => {
    for (const toolName of ['Task', 'TaskOutput', 'ExitPlanMode', 'KillShell', 'EnterPlanMode', 'TodoRead']) {
      const r = makeRecord();
      const pending = makePendingWithEntry('tu_1', toolName, {});
      const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }]);
      handleEvent(ev, r, pending, 0, 0);
      expect(r.toolCalls).toHaveLength(0);
    }
  });

  it('array content blocks are joined into a single result string', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'Read', {});
    const ev = makeUserEv([
      {
        type: 'tool_result',
        tool_use_id: 'tu_1',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'text', text: 'line two' },
        ],
        is_error: false,
      },
    ]);
    handleEvent(ev, record, pending, 0, 0);
    expect(record.toolCalls[0].result).toContain('line one');
    expect(record.toolCalls[0].result).toContain('line two');
  });

  it('WebFetch tool is classified as a doc lookup', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'WebFetch', { url: 'https://auth0.com/docs' });
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'doc content', is_error: false }]);
    handleEvent(ev, record, pending, 0, 0);
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });

  it('AskUserQuestion tool is classified as an interruption', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'AskUserQuestion', { question: 'Which tenant?' });
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'answer', is_error: false }]);
    handleEvent(ev, record, pending, 0, 0);
    expect(record.toolCalls[0].isInterruption).toBe(true);
  });

  it('mcp__ prefixed tool is classified as a doc lookup', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'mcp__auth0__search_auth0_docs', { query: 'login' });
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'docs', is_error: false }]);
    handleEvent(ev, record, pending, 0, 0);
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });

  it('returns TurnStateUpdate with updated prevTurnEndTime', () => {
    const record = makeRecord();
    const before = Date.now() / 1000;
    const pending = makePendingWithEntry('tu_1', 'Bash', { command: 'ls' });
    const ev = makeUserEv([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }]);
    const result = handleEvent(ev, record, pending, 2, 0) as TurnStateUpdate;
    const after = Date.now() / 1000;
    expect(result).not.toBeNull();
    expect(result.turnNum).toBe(2); // user events do not increment turnNum
    expect(result.prevTurnEndTime).toBeGreaterThanOrEqual(before);
    expect(result.prevTurnEndTime).toBeLessThanOrEqual(after + 0.01);
  });
});

// ── handleEvent — result ──────────────────────────────────────────────────────

describe('handleEvent — result', () => {
  it('success subtype sets status to success', () => {
    const record = makeRecord();
    handleEvent(makeResultEv({ subtype: 'success' }), record, makePending(), 0, 0);
    expect(record.status).toBe('success');
  });

  it('error_max_turns sets status to failure and records the subtype', () => {
    const record = makeRecord();
    handleEvent(makeResultEv({ subtype: 'error_max_turns' }), record, makePending(), 0, 0);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('error_max_turns'))).toBe(true);
  });

  it('other subtype sets status to failure and records the subtype', () => {
    const record = makeRecord();
    handleEvent(makeResultEv({ subtype: 'error_during_execution' }), record, makePending(), 0, 0);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('error_during_execution'))).toBe(true);
  });

  it('updates inputTokens and outputTokens from authoritative usage', () => {
    const record = makeRecord();
    record.inputTokens = 999;
    record.outputTokens = 888;
    handleEvent(makeResultEv({ input_tokens: 500, output_tokens: 200 }), record, makePending(), 0, 0);
    expect(record.inputTokens).toBe(500);
    expect(record.outputTokens).toBe(200);
  });

  it('sets costUsd from total_cost_usd', () => {
    const record = makeRecord();
    handleEvent(makeResultEv({ total_cost_usd: 0.1234 }), record, makePending(), 0, 0);
    expect(record.costUsd).toBe(0.1234);
  });

  it('uses result string as finalSummary when record has none', () => {
    const record = makeRecord();
    handleEvent(makeResultEv({ subtype: 'success', result: 'Task complete.' }), record, makePending(), 0, 0);
    expect(record.finalSummary).toBe('Task complete.');
  });

  it('does not overwrite an existing finalSummary', () => {
    const record = makeRecord();
    record.finalSummary = 'Already set by assistant event.';
    handleEvent(makeResultEv({ subtype: 'success', result: 'Should not overwrite.' }), record, makePending(), 0, 0);
    expect(record.finalSummary).toBe('Already set by assistant event.');
  });

  it('success subtype with is_error:true sets failure and records the API error message', () => {
    const record = makeRecord();
    const ev: CcResultEvent = {
      ...makeResultEv({ subtype: 'success', result: 'API Error (bad-model): 400 invalid model' }),
      is_error: true,
    };
    handleEvent(ev, record, makePending(), 0, 0);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('invalid model'))).toBe(true);
  });

  it('returns null', () => {
    const record = makeRecord();
    const result = handleEvent(makeResultEv(), record, makePending(), 0, 0);
    expect(result).toBeNull();
  });
});

// ── handleEvent — unknown event type ─────────────────────────────────────────

describe('handleEvent — unknown event type', () => {
  it('returns null without mutating record', () => {
    const record = makeRecord();
    const before = JSON.stringify(record);
    const result = handleEvent({ type: 'debug' }, record, makePending(), 0, 0);
    expect(result).toBeNull();
    expect(JSON.stringify(record)).toBe(before);
  });
});

// ── ClaudeCodeTranslator.mapName ──────────────────────────────────────────────

describe('ClaudeCodeTranslator — mapName', () => {
  const translator = new ClaudeCodeTranslator();

  it.each([
    ['Bash', 'run_command'],
    ['Read', 'read_file'],
    ['Write', 'write_file'],
    ['Edit', 'write_file'],
    ['MultiEdit', 'write_file'],
    ['Glob', 'list_files'],
    ['Grep', 'list_files'],
    ['LS', 'list_files'],
    ['WebFetch', 'fetch_url'],
    ['WebSearch', 'fetch_url'],
    ['AskUserQuestion', 'ask_user'],
    ['TodoRead', 'read_file'],
  ])('%s → %s', (ccName, expected) => {
    expect(translator.mapName(ccName)).toBe(expected);
  });

  it('unknown tool falls back to lowercased cc name', () => {
    expect(translator.mapName('SomeFutureTool')).toBe('somefuturetool');
    expect(translator.mapName('mcp__auth0__search')).toBe('mcp__auth0__search');
  });
});

// ── ClaudeCodeTranslator.normalizeArgs ────────────────────────────────────────

describe('ClaudeCodeTranslator — normalizeArgs', () => {
  const translator = new ClaudeCodeTranslator();

  it('Bash: extracts command', () => {
    expect(translator.normalizeArgs('Bash', { command: 'npm test' })).toEqual({ command: 'npm test' });
  });

  it('Bash: falls back to cmd', () => {
    expect(translator.normalizeArgs('Bash', { cmd: 'ls' })).toEqual({ command: 'ls' });
  });

  it('Read: extracts file_path as path', () => {
    expect(translator.normalizeArgs('Read', { file_path: 'src/index.ts' })).toEqual({ path: 'src/index.ts' });
  });

  it('Read: falls back to path', () => {
    expect(translator.normalizeArgs('Read', { path: 'src/index.ts' })).toEqual({ path: 'src/index.ts' });
  });

  it('Write: extracts path and content', () => {
    expect(translator.normalizeArgs('Write', { file_path: 'out.txt', content: 'hello' })).toEqual({
      path: 'out.txt',
      content: 'hello',
    });
  });

  it('Edit: extracts path and new_string as content', () => {
    expect(translator.normalizeArgs('Edit', { file_path: 'app.ts', new_string: 'const x = 1;' })).toEqual({
      path: 'app.ts',
      content: 'const x = 1;',
    });
  });

  it('MultiEdit: extracts path only', () => {
    expect(translator.normalizeArgs('MultiEdit', { file_path: 'app.ts' })).toEqual({ path: 'app.ts' });
  });

  it('Glob: maps pattern to path', () => {
    expect(translator.normalizeArgs('Glob', { pattern: '**/*.ts' })).toEqual({ path: '**/*.ts' });
  });

  it('Grep: maps pattern to command, path defaults to .', () => {
    expect(translator.normalizeArgs('Grep', { pattern: 'import', path: 'src' })).toEqual({
      path: 'src',
      command: 'grep "import"',
    });
  });

  it('LS: extracts path', () => {
    expect(translator.normalizeArgs('LS', { path: '/tmp' })).toEqual({ path: '/tmp' });
  });

  it('LS: defaults path to .', () => {
    expect(translator.normalizeArgs('LS', {})).toEqual({ path: '.' });
  });

  it('WebFetch: extracts url', () => {
    expect(translator.normalizeArgs('WebFetch', { url: 'https://auth0.com/docs' })).toEqual({
      url: 'https://auth0.com/docs',
    });
  });

  it('WebSearch: maps query to url', () => {
    expect(translator.normalizeArgs('WebSearch', { query: 'auth0 login' })).toEqual({ url: 'auth0 login' });
  });

  it('AskUserQuestion: extracts question', () => {
    expect(translator.normalizeArgs('AskUserQuestion', { question: 'Which tenant?' })).toEqual({
      question: 'Which tenant?',
    });
  });

  it('unknown tool returns input unchanged', () => {
    const input = { custom: 'arg', value: 42 };
    expect(translator.normalizeArgs('SomeFutureTool', input)).toEqual(input);
  });
});

// ── processStreamChunk tests ──────────────────────────────────────────────────

function makeState(overrides: Partial<StreamState> = {}): StreamState {
  return { turnNum: 0, prevTurnEndTime: 0, parseFailures: 0, ...overrides };
}

function makeCtx(
  record = makeRecord(),
  pending: PendingMap = makePending(),
  state: StreamState = makeState(),
): ProcessingContext {
  return { record, pending, state };
}

describe('processStreamChunk', () => {
  it('returns an empty string when input has no partial line', () => {
    const remaining = processStreamChunk('', '{"type":"system","subtype":"init","session_id":"s1"}\n', {
      record: makeRecord(),
      pending: makePending(),
      state: makeState(),
    });
    expect(remaining).toBe('');
  });

  it('buffers partial lines and returns the incomplete tail', () => {
    const ctx = makeCtx();
    // Chunk ends mid-JSON — should be returned as the remainder
    const remaining = processStreamChunk('', '{"type":"system","subt', ctx);
    expect(remaining).toBe('{"type":"system","subt');
    expect(ctx.state.parseFailures).toBe(0);
    expect(ctx.record.providerErrors).toHaveLength(0);
  });

  it('joins buf + chunk before splitting so split lines are processed', () => {
    const ctx = makeCtx();
    const firstChunk = '{"type":"system","subtype":"init","session_id":"s1"}';
    // Second chunk completes the first line and starts a new partial
    const remaining = processStreamChunk(firstChunk, '\n{"type":"partial"', ctx);
    // The completed first line is processed; the partial tail is returned
    expect(remaining).toBe('{"type":"partial"');
    expect(ctx.state.parseFailures).toBe(0);
  });

  it('skips empty and whitespace-only lines silently', () => {
    const ctx = makeCtx();
    const remaining = processStreamChunk('', '   \n\n\t\n', ctx);
    expect(remaining).toBe('');
    expect(ctx.state.parseFailures).toBe(0);
    expect(ctx.record.providerErrors).toHaveLength(0);
  });

  it('increments parseFailures and adds providerError on malformed JSON', () => {
    const ctx = makeCtx();
    processStreamChunk('', 'not-valid-json\n', ctx);
    expect(ctx.state.parseFailures).toBe(1);
    expect(ctx.record.providerErrors).toHaveLength(1);
    expect(ctx.record.providerErrors[0]).toContain('stream_parse_error');
  });

  it('accumulates multiple parse failures across chunks', () => {
    const ctx = makeCtx();
    processStreamChunk('', 'bad1\nbad2\n', ctx);
    expect(ctx.state.parseFailures).toBe(2);
    expect(ctx.record.providerErrors).toHaveLength(2);
  });

  it('processes a result event and sets finalSummary and status', () => {
    const ctx = makeCtx();
    const resultEvent: CcResultEvent = {
      type: 'result',
      subtype: 'success',
      result: 'Task complete',
      session_id: 's1',
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
    processStreamChunk('', JSON.stringify(resultEvent) + '\n', ctx);
    expect(ctx.record.finalSummary).toBe('Task complete');
    expect(ctx.record.status).toBe('success');
  });

  it('flush pattern: processStreamChunk with "\\n" processes buffered remainder', () => {
    const ctx = makeCtx();
    // First call: partial line stored in returned buf
    const buf = processStreamChunk('', '{"type":"system","subtype":"init","session_id":"s2"}', ctx);
    expect(buf).toBe('{"type":"system","subtype":"init","session_id":"s2"}');
    // Flush: append "\n" to force the buffered line to be processed
    const remaining = processStreamChunk(buf, '\n', ctx);
    expect(remaining).toBe('');
    expect(ctx.state.parseFailures).toBe(0);
  });

  it('updates state.turnNum and state.prevTurnEndTime after an assistant event', () => {
    const record = makeRecord();
    record.startTime = 1000;
    const state = makeState({ prevTurnEndTime: record.startTime });
    const ctx = { record, pending: makePending(), state };
    const assistantEvent: CcAssistantEvent = {
      type: 'assistant',
      session_id: 's1',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    };
    processStreamChunk('', JSON.stringify(assistantEvent) + '\n', ctx);
    // turnNum should have advanced from 0 to 1
    expect(ctx.state.turnNum).toBe(1);
  });
});
