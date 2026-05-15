/**
 * Unit tests for handleMessage, normaliseStopReason, and runClaudeCodeAgent.
 *
 * handleMessage is pure data transformation — it takes an SDK message and
 * mutates a RunRecord / pending map. No subprocess, no filesystem, no mocking required.
 *
 * runClaudeCodeAgent tests mock the SDK's query() function to return controlled
 * async iterables, verifying timeout, error, orphaned-tool, and fallback logic.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { setFrameworkConfig } from '@a0/eval-core';
import type { FrameworkConfig } from '@a0/eval-core';

const TEST_CONFIG: Required<FrameworkConfig> = {
  evalsDir: 'src/evals',
  proxy: { baseUrl: 'https://llm.atko.ai/v1' },
  mcp: {
    servers: {
      'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
    },
  },
  skills: {
    remoteRepos: [
      {
        url: 'https://github.com/auth0/agent-skills.git',
        localPath: 'skills-remote/auth0-skills',
        skillsPath: 'plugins/auth0/skills',
      },
    ],
    localDirs: ['skills'],
  },
  judge: {
    model: 'claude-sonnet-4-5',
    maxTokens: 1024,
    maxCodeChars: 16_384,
    promptsDir: 'src/prompts/judge',
  },
  models: {
    known: ['gpt-5.4', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'gemini-3.1-pro-preview'],
    default: 'gpt-5.4',
    bedrock: {
      'claude-sonnet-4-6': 'global.anthropic.claude-sonnet-4-6',
      'claude-opus-4-6': 'global.anthropic.claude-opus-4-6-v1',
      'claude-sonnet-4-5': 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'claude-opus-4-7': 'global.anthropic.claude-opus-4-7',
      'claude-opus-4-5': 'global.anthropic.claude-opus-4-5-20251101-v1:0',
    },
    litellm: {
      'claude-sonnet-4-6': '_claude-sonnet-4-6',
      'claude-opus-4-6': '_claude-opus-4-6',
      'claude-opus-4-7': '_claude-opus-4-7',
      'claude-sonnet-4-5': '_claude-sonnet-4-5',
      'claude-opus-4-5': '_claude-opus-4-5',
    },
  },
  agents: {
    'claude-code': { proxy: { baseUrl: 'https://llm.atko.ai/anthropic' } },
  },
};

beforeAll(() => {
  setFrameworkConfig(TEST_CONFIG);
});

import { MAX_TURNS } from '@a0/eval-core';
import { ClaudeCodeTranslator } from '../../src/runners/claude-code/translator.js';

// ── Mock for @anthropic-ai/claude-agent-sdk ───────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

// Must import after vi.mock so the mock is in place
import {
  handleMessage,
  normaliseStopReason,
  runClaudeCodeAgent,
  CLAUDE_CODE_MODEL_ID,
  type TurnStateUpdate,
} from '../../src/runners/claude-code/agent.js';
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { RunRecord } from '@a0/eval-core';

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

function makeAssistantMsg(
  overrides: {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    stop_reason?: string | null;
    input_tokens?: number;
    output_tokens?: number;
  } = {},
): SDKAssistantMessage {
  return {
    type: 'assistant',
    uuid: 'uuid_1',
    session_id: 'sess_1',
    parent_tool_use_id: null,
    message: {
      id: 'msg_1',
      role: 'assistant',
      type: 'message',
      content: (overrides.content ?? []) as SDKAssistantMessage['message']['content'],
      model: 'claude-sonnet',
      stop_reason: overrides.stop_reason !== undefined ? overrides.stop_reason : null,
      stop_sequence: null,
      usage: {
        input_tokens: overrides.input_tokens ?? 10,
        output_tokens: overrides.output_tokens ?? 5,
      },
    } as SDKAssistantMessage['message'],
  } as SDKAssistantMessage;
}

function makeUserMsg(
  blocks: Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: string | Array<{ type: string; text: string }>;
    is_error?: boolean;
  }>,
): SDKUserMessage {
  return {
    type: 'user',
    session_id: 'sess_1',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: blocks,
    },
  } as SDKUserMessage;
}

function makeResultMsg(
  overrides: {
    subtype?: 'success' | 'error_max_turns' | 'error_during_execution';
    result?: string;
    total_cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
  } = {},
): SDKResultMessage {
  const subtype = overrides.subtype ?? 'success';
  return {
    type: 'result',
    subtype,
    uuid: 'uuid_r',
    session_id: 'sess_1',
    is_error: subtype !== 'success',
    result: overrides.result ?? '',
    duration_ms: 5000,
    duration_api_ms: 4000,
    num_turns: 3,
    stop_reason: null,
    total_cost_usd: overrides.total_cost_usd ?? 0.05,
    usage: {
      input_tokens: overrides.input_tokens ?? 500,
      output_tokens: overrides.output_tokens ?? 200,
    },
    modelUsage: {},
    permission_denials: [],
  } as SDKResultMessage;
}

// ── normaliseStopReason ───────────────────────────────────────────────────────

describe('normaliseStopReason', () => {
  it('maps tool_use → tool_calls', () => expect(normaliseStopReason('tool_use')).toBe('tool_calls'));
  it('maps end_turn → stop', () => expect(normaliseStopReason('end_turn')).toBe('stop'));
  it('maps max_tokens → max_tokens', () => expect(normaliseStopReason('max_tokens')).toBe('max_tokens'));
  it('maps stop_sequence → stop', () => expect(normaliseStopReason('stop_sequence')).toBe('stop'));
  it('maps unknown value → unknown', () => {
    expect(normaliseStopReason('some_future_reason')).toBe('unknown');
    expect(normaliseStopReason('')).toBe('unknown');
  });
});

// ── handleMessage — system ──────────────────────────────────────────────────────

describe('handleMessage — system', () => {
  it('init event enriches model and sets sessionId', () => {
    const record = makeRecord();
    const msg = {
      type: 'system',
      subtype: 'init',
      uuid: 'uuid_sys',
      session_id: 'sess_abc',
      model: 'claude-sonnet-4-5',
      cwd: '/tmp',
      tools: [],
      mcp_servers: [],
      permissionMode: 'bypassPermissions',
      slash_commands: [],
      output_style: 'concise',
      skills: [],
      plugins: [],
      apiKeySource: 'user',
      claude_code_version: '1.0.0',
    } as unknown as SDKSystemMessage;
    const result = handleMessage(msg, record, makePending(), 0, 0);
    expect(result).toBeNull();
    expect(record.model).toBe('claude-sonnet-4-5');
    expect(record.sessionId).toBe('sess_abc');
  });

  it('init with empty model falls back to CLAUDE_CODE_MODEL_ID', () => {
    const record = makeRecord();
    const msg = {
      type: 'system',
      subtype: 'init',
      uuid: 'uuid_sys',
      session_id: 'sess_xyz',
      model: '',
      cwd: '/tmp',
      tools: [],
      mcp_servers: [],
      permissionMode: 'bypassPermissions',
      slash_commands: [],
      output_style: 'concise',
      skills: [],
      plugins: [],
      apiKeySource: 'user',
      claude_code_version: '1.0.0',
    } as unknown as SDKSystemMessage;
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.model).toBe(CLAUDE_CODE_MODEL_ID);
  });

  it('non-init subtype returns null without mutating record', () => {
    const record = makeRecord();
    const before = { ...record };
    const msg = {
      type: 'system',
      subtype: 'hook_response',
      uuid: 'uuid_sys',
      session_id: 'sess_1',
    } as unknown as SDKMessage;
    const result = handleMessage(msg, record, makePending(), 0, 0);
    expect(result).toBeNull();
    expect(record.model).toBe(before.model);
    expect(record.sessionId).toBe(before.sessionId);
  });
});

// ── handleMessage — assistant ───────────────────────────────────────────────────

describe('handleMessage — assistant', () => {
  it('accumulates tokens into record', () => {
    const record = makeRecord();
    record.inputTokens = 100;
    record.outputTokens = 50;
    handleMessage(makeAssistantMsg({ input_tokens: 20, output_tokens: 8 }), record, makePending(), 0, 0);
    expect(record.inputTokens).toBe(120);
    expect(record.outputTokens).toBe(58);
  });

  it('registers tool_use blocks into the pending map', () => {
    const record = makeRecord();
    const pending = makePending();
    const msg = makeAssistantMsg({
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'src/index.ts' } },
        { type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'npm test' } },
      ],
    });
    handleMessage(msg, record, pending, 0, 0);
    expect(pending.has('tu_1')).toBe(true);
    expect(pending.get('tu_1')?.name).toBe('Read');
    expect(pending.has('tu_2')).toBe(true);
    expect(pending.get('tu_2')?.name).toBe('Bash');
  });

  it('with tool_use content → TurnMetric finishReason is tool_calls', () => {
    const record = makeRecord();
    const msg = makeAssistantMsg({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }],
    });
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.turnMetrics[0].finishReason).toBe('tool_calls');
    expect(record.turnMetrics[0].toolCallCount).toBe(1);
  });

  it('without tool_use content → TurnMetric finishReason is stop', () => {
    const record = makeRecord();
    const msg = makeAssistantMsg({ content: [{ type: 'text', text: 'Done.' }] });
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.turnMetrics).toHaveLength(1);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
    expect(record.turnMetrics[0].toolCallCount).toBe(0);
  });

  it('sets finalSummary from text content when stop_reason is end_turn', () => {
    const record = makeRecord();
    const msg = makeAssistantMsg({
      content: [{ type: 'text', text: 'Integration complete.' }],
      stop_reason: 'end_turn',
    });
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.finalSummary).toBe('Integration complete.');
  });

  it('does not overwrite existing finalSummary with empty text', () => {
    const record = makeRecord();
    record.finalSummary = 'Previous summary.';
    const msg = makeAssistantMsg({ content: [], stop_reason: 'end_turn' });
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.finalSummary).toBe('Previous summary.');
  });

  it('stop_reason null with no tool_use → derives end_turn → finishReason stop', () => {
    const record = makeRecord();
    const msg = makeAssistantMsg({ content: [{ type: 'text', text: 'All done.' }], stop_reason: null });
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.turnMetrics[0].finishReason).toBe('stop');
  });

  it('stop_reason null with tool_use → derives tool_use → finishReason tool_calls', () => {
    const record = makeRecord();
    const msg = makeAssistantMsg({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }],
      stop_reason: null,
    });
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.turnMetrics[0].finishReason).toBe('tool_calls');
  });

  it('returns TurnStateUpdate with incremented turnNum', () => {
    const record = makeRecord();
    const result = handleMessage(makeAssistantMsg(), record, makePending(), 3, 0) as TurnStateUpdate;
    expect(result).not.toBeNull();
    expect(result.turnNum).toBe(4);
  });

  it('TurnMetric records the incremented turn number', () => {
    const record = makeRecord();
    handleMessage(makeAssistantMsg({ input_tokens: 10, output_tokens: 5 }), record, makePending(), 2, 0);
    expect(record.turnMetrics[0].turn).toBe(3);
    expect(record.turnMetrics[0].inputTokens).toBe(10);
    expect(record.turnMetrics[0].outputTokens).toBe(5);
  });
});

// ── handleMessage — user ────────────────────────────────────────────────────────

describe('handleMessage — user', () => {
  function makePendingWithEntry(id: string, name: string, input: Record<string, unknown> = {}): PendingMap {
    return makePending([[id, { name, input, startTime: Date.now() / 1000 - 0.1 }]]);
  }

  it('resolves pending tool and creates ToolCallRecord', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'Read', { file_path: 'src/app.ts' });
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents', is_error: false }]);
    handleMessage(msg, record, pending, 1, 0);
    expect(pending.has('tu_1')).toBe(false);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('read_file');
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
      const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: false }]);
      handleMessage(msg, r, pending, 0, 0);
      expect(r.toolCalls[0].name).toBe(expectedName);
    }
  });

  it('unknown tool name falls back to lowercase', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'SomeFutureTool', {});
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'result', is_error: false }]);
    handleMessage(msg, record, pending, 0, 0);
    expect(record.toolCalls[0].name).toBe('somefuturetool');
  });

  it('is_error=true sets causedError, errorCategory, and pushes to providerErrors', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'Bash', { command: 'npm test' });
    const msg = makeUserMsg([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'permission denied: cannot write', is_error: true },
    ]);
    handleMessage(msg, record, pending, 0, 0);
    const tc = record.toolCalls[0];
    expect(tc.causedError).toBe(true);
    expect(tc.errorCategory).toBe('permission');
    expect(record.providerErrors.some((e) => e.includes('run_command'))).toBe(true);
  });

  it('is_error=false does not push to providerErrors', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'Read', { file_path: 'index.ts' });
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'content', is_error: false }]);
    handleMessage(msg, record, pending, 0, 0);
    expect(record.providerErrors).toHaveLength(0);
  });

  it('orphaned tool_use_id (not in pending) is skipped', () => {
    const record = makeRecord();
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'unknown_id', content: 'x', is_error: false }]);
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.toolCalls).toHaveLength(0);
  });

  it('TodoWrite is tracked as write_file', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'TodoWrite', { todos: [] });
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }]);
    handleMessage(msg, record, pending, 0, 0);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('write_file');
  });

  it('planning tools are tracked (Task, TaskOutput, TodoRead, EnterPlanMode, ExitPlanMode)', () => {
    const expected: Record<string, string> = {
      Task: 'run_command',
      TaskOutput: 'read_file',
      TodoRead: 'read_file',
      EnterPlanMode: 'plan',
      ExitPlanMode: 'plan',
    };
    for (const [toolName, mappedName] of Object.entries(expected)) {
      const r = makeRecord();
      const pending = makePendingWithEntry('tu_1', toolName, {});
      const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }]);
      handleMessage(msg, r, pending, 0, 0);
      expect(r.toolCalls).toHaveLength(1);
      expect(r.toolCalls[0].name).toBe(mappedName);
    }
  });

  it('KillShell is tracked as run_command', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'KillShell', { shell_id: '42' });
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }]);
    handleMessage(msg, record, pending, 0, 0);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('run_command');
  });

  it('array content blocks are joined into a single result string', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'Read', {});
    const msg = makeUserMsg([
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
    handleMessage(msg, record, pending, 0, 0);
    expect(record.toolCalls[0].result).toContain('line one');
    expect(record.toolCalls[0].result).toContain('line two');
  });

  it('WebFetch tool is classified as a doc lookup', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'WebFetch', { url: 'https://auth0.com/docs' });
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'doc content', is_error: false }]);
    handleMessage(msg, record, pending, 0, 0);
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });

  it('AskUserQuestion tool is classified as an interruption', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'AskUserQuestion', { question: 'Which tenant?' });
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'answer', is_error: false }]);
    handleMessage(msg, record, pending, 0, 0);
    expect(record.toolCalls[0].isInterruption).toBe(true);
  });

  it('mcp__ prefixed tool is classified as a doc lookup', () => {
    const record = makeRecord();
    const pending = makePendingWithEntry('tu_1', 'mcp__auth0__search_auth0_docs', { query: 'login' });
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'docs', is_error: false }]);
    handleMessage(msg, record, pending, 0, 0);
    expect(record.toolCalls[0].isDocLookup).toBe(true);
  });

  it('returns TurnStateUpdate with updated prevTurnEndTime', () => {
    const record = makeRecord();
    const before = Date.now() / 1000;
    const pending = makePendingWithEntry('tu_1', 'Bash', { command: 'ls' });
    const msg = makeUserMsg([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }]);
    const result = handleMessage(msg, record, pending, 2, 0) as TurnStateUpdate;
    const after = Date.now() / 1000;
    expect(result).not.toBeNull();
    expect(result.turnNum).toBe(2); // user events do not increment turnNum
    expect(result.prevTurnEndTime).toBeGreaterThanOrEqual(before);
    expect(result.prevTurnEndTime).toBeLessThanOrEqual(after + 0.01);
  });
});

// ── handleMessage — result ──────────────────────────────────────────────────────

describe('handleMessage — result', () => {
  it('success subtype sets status to success', () => {
    const record = makeRecord();
    handleMessage(makeResultMsg({ subtype: 'success' }), record, makePending(), 0, 0);
    expect(record.status).toBe('success');
  });

  it('error_max_turns sets status to failure and records the subtype', () => {
    const record = makeRecord();
    handleMessage(makeResultMsg({ subtype: 'error_max_turns' }), record, makePending(), 0, 0);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('error_max_turns'))).toBe(true);
  });

  it('other subtype sets status to failure and records the subtype', () => {
    const record = makeRecord();
    handleMessage(makeResultMsg({ subtype: 'error_during_execution' }), record, makePending(), 0, 0);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('error_during_execution'))).toBe(true);
  });

  it('updates inputTokens and outputTokens from authoritative usage', () => {
    const record = makeRecord();
    record.inputTokens = 999;
    record.outputTokens = 888;
    handleMessage(makeResultMsg({ input_tokens: 500, output_tokens: 200 }), record, makePending(), 0, 0);
    expect(record.inputTokens).toBe(500);
    expect(record.outputTokens).toBe(200);
  });

  it('sets costUsd from total_cost_usd', () => {
    const record = makeRecord();
    handleMessage(makeResultMsg({ total_cost_usd: 0.1234 }), record, makePending(), 0, 0);
    expect(record.costUsd).toBe(0.1234);
  });

  it('uses result string as finalSummary when record has none', () => {
    const record = makeRecord();
    handleMessage(makeResultMsg({ subtype: 'success', result: 'Task complete.' }), record, makePending(), 0, 0);
    expect(record.finalSummary).toBe('Task complete.');
  });

  it('does not overwrite an existing finalSummary', () => {
    const record = makeRecord();
    record.finalSummary = 'Already set by assistant event.';
    handleMessage(makeResultMsg({ subtype: 'success', result: 'Should not overwrite.' }), record, makePending(), 0, 0);
    expect(record.finalSummary).toBe('Already set by assistant event.');
  });

  it('success subtype with is_error:true sets failure and records the API error message', () => {
    const record = makeRecord();
    const msg = {
      ...makeResultMsg({ subtype: 'success', result: 'API Error (bad-model): 400 invalid model' }),
      is_error: true,
    } as SDKResultMessage;
    handleMessage(msg, record, makePending(), 0, 0);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('invalid model'))).toBe(true);
  });

  it('returns null', () => {
    const record = makeRecord();
    const result = handleMessage(makeResultMsg(), record, makePending(), 0, 0);
    expect(result).toBeNull();
  });
});

// ── handleMessage — unknown event type ─────────────────────────────────────────

describe('handleMessage — unknown event type', () => {
  it('returns null without mutating record', () => {
    const record = makeRecord();
    const before = JSON.stringify(record);
    const result = handleMessage({ type: 'tool_progress' } as unknown as SDKMessage, record, makePending(), 0, 0);
    expect(result).toBeNull();
    expect(JSON.stringify(record)).toBe(before);
  });
});

// ── runClaudeCodeAgent ────────────────────────────────────────────────────────

async function* fakeQuery(messages: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  for (const m of messages) yield m;
}

async function* fakeQueryThatThrows(messages: SDKMessage[], error: Error): AsyncGenerator<SDKMessage, void> {
  for (const m of messages) yield m;
  throw error;
}

const evalDef = { id: 'test_eval', userPrompt: 'Integrate Auth0 into a React app' };
const workspace = '/tmp/test-workspace';

describe('runClaudeCodeAgent', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successful run with result message sets status, tokens, and cost', async () => {
    const messages: SDKMessage[] = [
      {
        type: 'system',
        subtype: 'init',
        uuid: 'u1',
        session_id: 's1',
        model: 'claude-sonnet-4-5',
        cwd: workspace,
        tools: [],
        mcp_servers: [],
        permissionMode: 'bypassPermissions',
        slash_commands: [],
        output_style: 'concise',
        skills: [],
        plugins: [],
        apiKeySource: 'user',
        claude_code_version: '1.0.0',
      } as unknown as SDKMessage,
      makeAssistantMsg({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'src/app.ts' } }],
        input_tokens: 100,
        output_tokens: 20,
      }) as SDKMessage,
      makeUserMsg([
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents', is_error: false },
      ]) as SDKMessage,
      makeAssistantMsg({
        content: [{ type: 'text', text: 'Done integrating Auth0.' }],
        stop_reason: 'end_turn',
        input_tokens: 50,
        output_tokens: 10,
      }) as SDKMessage,
      makeResultMsg({
        subtype: 'success',
        result: 'Task complete.',
        total_cost_usd: 0.042,
        input_tokens: 150,
        output_tokens: 30,
      }) as SDKMessage,
    ];

    mockQuery.mockReturnValue(fakeQuery(messages));
    const record = await runClaudeCodeAgent(evalDef, workspace);

    expect(record.status).toBe('success');
    expect(record.inputTokens).toBe(150);
    expect(record.outputTokens).toBe(30);
    expect(record.costUsd).toBe(0.042);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('read_file');
    expect(record.finalSummary).toBe('Done integrating Auth0.');
    expect(record.providerErrors).toHaveLength(0);
  });

  it('SDK error sets status to failure with error in providerErrors', async () => {
    mockQuery.mockReturnValue(fakeQueryThatThrows([], new Error('connection refused')));
    const record = await runClaudeCodeAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors).toContain('sdk error: connection refused');
  });

  it('empty stream (zero turns, no result) sets status to failure', async () => {
    mockQuery.mockReturnValue(fakeQuery([]));
    const record = await runClaudeCodeAgent(evalDef, workspace);
    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('no result event received'))).toBe(true);
  });

  it('stream with turns but no result message falls back to success', async () => {
    mockQuery.mockReturnValue(
      fakeQuery([
        makeAssistantMsg({ content: [{ type: 'text', text: 'All done.' }], stop_reason: 'end_turn' }) as SDKMessage,
      ]),
    );
    const record = await runClaudeCodeAgent(evalDef, workspace);
    expect(record.status).toBe('success');
    expect(record.turnMetrics).toHaveLength(1);
  });

  it('orphaned tool_use blocks are drained into toolCalls and providerErrors', async () => {
    mockQuery.mockReturnValue(
      fakeQuery([
        makeAssistantMsg({
          content: [{ type: 'tool_use', id: 'tu_orphan', name: 'Bash', input: { command: 'npm install' } }],
        }) as SDKMessage,
      ]),
    );
    const record = await runClaudeCodeAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('run_command');
    expect(record.toolCalls[0].result).toBe('<orphaned: result event never received>');
    expect(record.toolCalls[0].causedError).toBe(true);
    expect(record.providerErrors.some((e) => e.includes('orphaned tool_use: Bash'))).toBe(true);
  });

  it('orphaned TodoWrite is tracked as write_file with causedError', async () => {
    mockQuery.mockReturnValue(
      fakeQuery([
        makeAssistantMsg({
          content: [{ type: 'tool_use', id: 'tu_internal', name: 'TodoWrite', input: {} }],
        }) as SDKMessage,
      ]),
    );
    const record = await runClaudeCodeAgent(evalDef, workspace);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('write_file');
    expect(record.toolCalls[0].causedError).toBe(true);
  });

  it('SDK error after abort does not overwrite failure status', async () => {
    async function* abortingQuery(): AsyncGenerator<SDKMessage, void> {
      yield makeAssistantMsg({ content: [{ type: 'text', text: 'Working...' }] }) as SDKMessage;
      throw new Error('aborted');
    }

    mockQuery.mockReturnValue(abortingQuery());
    const record = await runClaudeCodeAgent(evalDef, workspace);

    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('sdk error: aborted'))).toBe(true);
  });

  it('record endTime is always set', async () => {
    mockQuery.mockReturnValue(fakeQuery([]));
    const before = Date.now() / 1000;
    const record = await runClaudeCodeAgent(evalDef, workspace);
    const after = Date.now() / 1000;
    expect(record.endTime).toBeGreaterThanOrEqual(before);
    expect(record.endTime).toBeLessThanOrEqual(after + 0.01);
  });

  it('aborts when MAX_TURNS is reached', async () => {
    // Generate MAX_TURNS + 5 assistant messages — only MAX_TURNS should be processed
    const messages: SDKMessage[] = [];
    for (let i = 0; i < MAX_TURNS + 5; i++) {
      messages.push(
        makeAssistantMsg({
          content: [{ type: 'tool_use', id: `tu_${i}`, name: 'Bash', input: { command: 'echo hi' } }],
        }) as SDKMessage,
      );
      messages.push(
        makeUserMsg([{ type: 'tool_result', tool_use_id: `tu_${i}`, content: 'hi', is_error: false }]) as SDKMessage,
      );
    }
    messages.push(makeResultMsg({ subtype: 'success' }) as SDKMessage);

    mockQuery.mockReturnValue(fakeQuery(messages));
    const record = await runClaudeCodeAgent(evalDef, workspace);

    expect(record.status).toBe('failure');
    expect(record.providerErrors.some((e) => e.includes('turn limit'))).toBe(true);
    expect(record.turnMetrics.length).toBe(MAX_TURNS);
  });
});

// ── ClaudeCodeTranslator ──────────────────────────────────────────────────────

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
    ['TodoWrite', 'write_file'],
    ['Task', 'run_command'],
    ['TaskOutput', 'read_file'],
    ['KillShell', 'run_command'],
    ['EnterPlanMode', 'plan'],
    ['ExitPlanMode', 'plan'],
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

  it('Skill: extracts skill as name', () => {
    expect(translator.normalizeArgs('Skill', { skill: 'auth0-quickstart' })).toEqual({ name: 'auth0-quickstart' });
  });

  it('TodoWrite: serializes todos array as content, uses __todo__ path', () => {
    expect(translator.normalizeArgs('TodoWrite', { todos: [{ id: 1, content: 'fix bug' }] })).toEqual({
      path: '__todo__',
      content: '[{"id":1,"content":"fix bug"}]',
    });
  });

  it('TodoWrite: falls back to content string when no todos field', () => {
    expect(translator.normalizeArgs('TodoWrite', { content: 'some text' })).toEqual({
      path: '__todo__',
      content: 'some text',
    });
  });

  it('TodoRead: uses __todo__ path', () => {
    expect(translator.normalizeArgs('TodoRead', {})).toEqual({ path: '__todo__' });
  });

  it('Task: maps description to command', () => {
    expect(translator.normalizeArgs('Task', { description: 'run tests' })).toEqual({ command: 'run tests' });
  });

  it('Task: falls back to task field', () => {
    expect(translator.normalizeArgs('Task', { task: 'build app' })).toEqual({ command: 'build app' });
  });

  it('TaskOutput: maps task_id to path', () => {
    expect(translator.normalizeArgs('TaskOutput', { task_id: 'abc123' })).toEqual({ path: 'abc123' });
  });

  it('KillShell: constructs kill command from shell_id', () => {
    expect(translator.normalizeArgs('KillShell', { shell_id: '42' })).toEqual({ command: 'kill shell 42' });
  });

  it('KillShell: falls back to id field', () => {
    expect(translator.normalizeArgs('KillShell', { id: '7' })).toEqual({ command: 'kill shell 7' });
  });

  it('unknown tool returns input unchanged', () => {
    const input = { custom: 'arg', value: 42 };
    expect(translator.normalizeArgs('SomeFutureTool', input)).toEqual(input);
  });
});

// ── ClaudeCodeTranslator.isDocLookup ──────────────────────────────────────────

describe('ClaudeCodeTranslator — isDocLookup', () => {
  const translator = new ClaudeCodeTranslator();

  it('returns true for WebFetch', () => {
    expect(translator.isDocLookup('WebFetch')).toBe(true);
  });

  it('returns true for WebSearch', () => {
    expect(translator.isDocLookup('WebSearch')).toBe(true);
  });

  it('returns true for mcp__ prefixed tools', () => {
    expect(translator.isDocLookup('mcp__auth0__search_auth0_docs')).toBe(true);
    expect(translator.isDocLookup('mcp__other__tool')).toBe(true);
  });

  it('returns false for non-doc tools', () => {
    expect(translator.isDocLookup('Bash')).toBe(false);
    expect(translator.isDocLookup('Read')).toBe(false);
    expect(translator.isDocLookup('Write')).toBe(false);
    expect(translator.isDocLookup('AskUserQuestion')).toBe(false);
  });
});

// ── ClaudeCodeTranslator.isInterruption ───────────────────────────────────────

describe('ClaudeCodeTranslator — isInterruption', () => {
  const translator = new ClaudeCodeTranslator();

  it('returns true for AskUserQuestion', () => {
    expect(translator.isInterruption('AskUserQuestion')).toBe(true);
  });

  it('returns false for non-interruption tools', () => {
    expect(translator.isInterruption('Bash')).toBe(false);
    expect(translator.isInterruption('Read')).toBe(false);
    expect(translator.isInterruption('WebFetch')).toBe(false);
    expect(translator.isInterruption('mcp__auth0__search')).toBe(false);
  });
});

// ── ClaudeCodeTranslator.isInternalTool ───────────────────────────────────────

describe('ClaudeCodeTranslator — isInternalTool', () => {
  const translator = new ClaudeCodeTranslator();

  it('no tools are internal', () => {
    for (const tool of ['TodoWrite', 'TodoRead', 'Task', 'TaskOutput', 'KillShell', 'EnterPlanMode', 'ExitPlanMode']) {
      expect(translator.isInternalTool(tool)).toBe(false);
    }
  });

  it('returns false for standard tools', () => {
    for (const tool of ['Bash', 'Read', 'Write', 'WebFetch', 'AskUserQuestion', 'Skill']) {
      expect(translator.isInternalTool(tool)).toBe(false);
    }
  });
});
