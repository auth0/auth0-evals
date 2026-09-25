/**
 * Cross-runner parity for `ToolCallRecord.result`.
 *
 * Graders are authored against `tc.result` as a runner-independent contract —
 * they `JSON.parse` it and read a domain field. That contract was broken for
 * `codex`, which recorded the raw MCP `{ content: [...] }` envelope while
 * `claude-code` and `gemini-cli` recorded the unwrapped body. `JSON.parse`
 * succeeded on the envelope, so the expected field simply came back `undefined`
 * and every result-parsing grader failed silently — indistinguishable from the
 * model not doing the work.
 *
 * This file takes ONE logical MCP payload, encodes it in each runner's native
 * SDK event shape, and asserts the recorded strings are byte-identical. It is
 * the regression guard: a new runner that stringifies its envelope, or an
 * "optimisation" that re-wraps one, fails here rather than three domains later
 * in someone's model-quality report.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { setFrameworkConfig } from '@a0/evals-core';
import { TEST_CONFIG } from '../test-config.js';

// The one payload under test — what the hosted Auth0 MCP server returns.
const PAYLOAD = JSON.stringify({
  applications: [
    { client_id: 'abc123', name: 'My SPA', app_type: 'spa' },
    { client_id: 'def456', name: 'My API Client', app_type: 'non_interactive' },
  ],
});

const MCP_SERVER = 'auth0-hosted';
const MCP_TOOL = 'auth0_list_applications';
const MAPPED_NAME = `mcp__${MCP_SERVER}__${MCP_TOOL}`;

beforeAll(() => {
  setFrameworkConfig({
    ...TEST_CONFIG,
    agents: {
      'claude-code': { proxy: { baseUrl: 'https://llm.example.com/anthropic' } },
    },
  });
});

// ── Mocks: codex needs its SDK and fs stubbed; claude-code's handleMessage is pure ──

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, mkdirSync: vi.fn(), writeFileSync: vi.fn(), realpathSync: vi.fn((p: string) => p) };
});

vi.mock('node:fs/promises', () => ({ rm: vi.fn().mockResolvedValue(undefined) }));

const codexSdk = vi.hoisted(() => {
  const state = { events: [] as Array<Record<string, unknown>> };
  async function* gen(events: Array<Record<string, unknown>>) {
    for (const ev of events) yield ev;
  }
  class Codex {
    startThread() {
      return {
        runStreamed: async () => ({ events: gen(state.events) }),
      };
    }
    resumeThread() {
      return this.startThread();
    }
  }
  return { state, Codex };
});

vi.mock('@openai/codex-sdk', () => ({ Codex: codexSdk.Codex }));

vi.mock('@a0/evals-core', async () => ({
  ...(await vi.importActual('@a0/evals-core')),
  getAgentProxyBaseUrl: vi.fn().mockReturnValue('https://llm.example.com'),
  mintMcpToken: vi.fn(),
}));

// Imported after the mocks so they are in place.
import { runCodexAgent } from '../../src/runners/codex/agent.js';
import { handleMessage, CLAUDE_CODE_MODEL_ID } from '../../src/runners/claude-code/agent.js';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RunRecord } from '@a0/evals-core';

const evalDef = { id: 'hosted_mcp_audit_tenant_applications', userPrompt: 'Audit the tenant applications.' };
const workspace = '/tmp/test-workspace';

beforeEach(() => {
  vi.clearAllMocks();
  codexSdk.state.events = [];
});

/** Runs the codex runner over one mcp_tool_call carrying `PAYLOAD` in its envelope. */
async function codexResult(): Promise<string> {
  codexSdk.state.events = [
    {
      type: 'item.completed',
      item: {
        type: 'mcp_tool_call',
        id: 'mcp_1',
        server: MCP_SERVER,
        tool: MCP_TOOL,
        arguments: {},
        // Native codex shape: McpToolCallItem.result is always this envelope object.
        result: { content: [{ type: 'text', text: PAYLOAD }], structured_content: null },
        error: null,
        status: 'completed',
      },
    },
    { type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } },
  ];

  const record = await runCodexAgent(evalDef, workspace);
  const tc = record.toolCalls.find((c) => c.name === MAPPED_NAME);
  expect(tc, 'codex recorded no MCP tool call').toBeDefined();
  return tc!.result;
}

/** Drives claude-code's handleMessage over one tool_result carrying `PAYLOAD`. */
function claudeCodeResult(): string {
  const record: RunRecord = {
    taskName: evalDef.id,
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
    workspace,
  };
  const pending = new Map([['tu_1', { name: MAPPED_NAME, input: {}, startTime: 0 }]]);

  // Native claude-code shape: tool_result.content is a bare content-block array.
  const msg = {
    type: 'user',
    session_id: 'sess_1',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: PAYLOAD }] }],
    },
  } as unknown as SDKUserMessage;

  handleMessage(msg, record, pending, 1, 0);
  const tc = record.toolCalls.find((c) => c.name === MAPPED_NAME);
  expect(tc, 'claude-code recorded no MCP tool call').toBeDefined();
  return tc!.result;
}

/**
 * gemini-cli and copilot receive the payload already flattened to a string by
 * their SDKs (`event.output` and `ev.data.result.content` respectively), so
 * their contribution to parity is that they pass it through untouched. Asserted
 * as a constant here rather than by booting two more runners.
 */
const flatRunnerResult = () => PAYLOAD;

describe('tc.result is identical across runners for the same MCP payload', () => {
  it('codex records the unwrapped payload', async () => {
    await expect(codexResult()).resolves.toBe(PAYLOAD);
  });

  it('claude-code records the unwrapped payload', () => {
    expect(claudeCodeResult()).toBe(PAYLOAD);
  });

  it('codex and claude-code agree byte for byte', async () => {
    expect(await codexResult()).toBe(claudeCodeResult());
  });

  it('all runners agree, so a grader can JSON.parse any of them the same way', async () => {
    const results = [await codexResult(), claudeCodeResult(), flatRunnerResult()];
    expect(new Set(results).size, `runners diverged: ${JSON.stringify(results, null, 2)}`).toBe(1);

    for (const result of results) {
      const parsed = JSON.parse(result) as { applications?: Array<{ client_id: string }> };
      expect(parsed.applications).toHaveLength(2);
      expect(parsed.applications!.map((a) => a.client_id)).toEqual(['abc123', 'def456']);
    }
  });
});
