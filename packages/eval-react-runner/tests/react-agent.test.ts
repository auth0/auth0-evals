/**
 * Tests for the ReAct agent runner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';

import { setFrameworkConfig, DEFAULT_FRAMEWORK_CONFIG } from '@a0/eval-core';
import type { FrameworkConfig } from '@a0/eval-core';

// Initialize the framework config singleton so internal @a0/eval functions work correctly.
const testConfig = {
  ...DEFAULT_FRAMEWORK_CONFIG,
  proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
  mcp: { servers: { 'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' } } },
  skills: {
    remoteRepos: [{ url: 'https://github.com/auth0/agent-skills.git', localPath: 'skills-remote/auth0-skills' }],
    localDirs: ['skills'],
  },
} as Required<FrameworkConfig>;
setFrameworkConfig(testConfig);

const mockClient = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  callTool: vi.fn(),
  listTools: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return mockClient;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () {}),
}));

import { extractTokens, summariseArgs, llmCall, runAgent } from '../src/agent.js';
import { isGeminiModel, detectRetry, collectFiles } from '@a0/eval-core';
import type { ToolCallRecord } from '@a0/eval-core';
import { TOOL_DEFINITIONS, buildToolDefinitions } from '../src/tools/index.js';

import { ToolExecutor } from '../src/tools-executor/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const EXCLUDED_DIRS = new Set(DEFAULT_FRAMEWORK_CONFIG.workspace.excludedDirs!);
const MAX_LISTED_FILES = DEFAULT_FRAMEWORK_CONFIG.workspace.maxListedFiles!;
import { buildMcpContext } from '../src/messages.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(agentSystemPrompt = '', userPrompt = 'Do the task.') {
  return { name: 'test_task', agentSystemPrompt, userPrompt };
}

function makeFinishResponse(summary = 'Done.') {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              function: {
                name: 'finish_task',
                arguments: JSON.stringify({ summary }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

function makeTextResponse(content = 'All done.') {
  return {
    choices: [{ message: { content, tool_calls: null }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

const tmpDir = makeTmpDir('agent_test_');

// ── TOOL_DEFINITIONS tests ─────────────────────────────────────────────────────

describe('TOOL_DEFINITIONS', () => {
  it('finish_task requires summary', () => {
    const finish = TOOL_DEFINITIONS.find((t) => t.function.name === 'finish_task')!;
    expect(finish.function.parameters.required).toContain('summary');
  });

  it('all expected tools are present', () => {
    const names = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));
    expect(names).toEqual(
      new Set(['read_file', 'list_files', 'write_file', 'run_command', 'fetch_url', 'ask_user', 'finish_task']),
    );
  });

  it('does not include search_auth0_docs by default', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).not.toContain('search_auth0_docs');
  });

  it('buildToolDefinitions without mcp excludes search_auth0_docs', () => {
    const defs = buildToolDefinitions([]);
    const names = (defs as { function: { name: string } }[]).map((t) => t.function.name);
    expect(names).not.toContain('search_auth0_docs');
  });

  it('buildToolDefinitions with mcp includes dynamically provided MCP tools', () => {
    const mcpDefs = [{ type: 'function', function: { name: 'search_auth0_docs' } }];
    const defs = buildToolDefinitions(['mcp'], mcpDefs);
    const names = (defs as { function: { name: string } }[]).map((t) => t.function.name);
    expect(names).toContain('search_auth0_docs');
  });
});

// ── tool_choice tests ─────────────────────────────────────────────────────────

describe('llmCall', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends tool_choice: required for standard model', async () => {
    let captured: Record<string, unknown> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok', tool_calls: null }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      } as unknown as Response;
    });

    await llmCall('key', 'gpt-4o', [{ role: 'user', content: 'test' }], TOOL_DEFINITIONS);
    expect(captured.tool_choice).toBe('required');
  });

  it('sends functions API for Gemini', async () => {
    let captured: Record<string, unknown> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok', tool_calls: null }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      } as unknown as Response;
    });

    await llmCall('key', 'gemini-3-pro-preview', [{ role: 'user', content: 'test' }], TOOL_DEFINITIONS);
    expect(captured.functions).toBeDefined();
    expect(captured.function_call).toBe('auto');
    expect(captured.tools).toBeUndefined();
    expect(captured.tool_choice).toBeUndefined();
  });

  it('gemini functions match tool definitions', async () => {
    let captured: Record<string, unknown> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok', tool_calls: null }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      } as unknown as Response;
    });

    await llmCall('key', 'gemini-2.5-pro', [{ role: 'user', content: 'test' }], TOOL_DEFINITIONS);
    const expectedNames = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));
    const actualNames = new Set((captured.functions as { name: string }[]).map((f) => f.name));
    expect(actualNames).toEqual(expectedNames);
  });
});

// ── ToolExecutor tests ────────────────────────────────────────────────────────

describe('ToolExecutor.finish_task', () => {
  it('returns summary', async () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result, isDoc, isInterrupt, isError] = await executor.execute('finish_task', { summary: 'Done.' });
    expect(result).toBe('Done.');
    expect(isDoc).toBe(false);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });

  it('returns default when no summary', async () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('finish_task', {});
    expect(result).toBe('Task complete.');
  });
});

// ── summariseArgs tests ───────────────────────────────────────────────────────

describe('summariseArgs', () => {
  it('includes summary for finish_task', () => {
    const result = summariseArgs('finish_task', { summary: 'Auth0 added.' });
    expect(result).toContain('Auth0 added');
  });

  it('truncates long summary', () => {
    const result = summariseArgs('finish_task', { summary: 'x'.repeat(100) });
    expect(result.length).toBeLessThanOrEqual(65);
  });
});

// ── extractTokens tests ───────────────────────────────────────────────────────

describe('extractTokens', () => {
  it('handles OpenAI style', () => {
    const [input, output] = extractTokens({ prompt_tokens: 10, completion_tokens: 5 });
    expect(input).toBe(10);
    expect(output).toBe(5);
  });

  it('handles Anthropic style', () => {
    const [input, output] = extractTokens({ input_tokens: 20, output_tokens: 8 });
    expect(input).toBe(20);
    expect(output).toBe(8);
  });

  it('defaults to zero when missing', () => {
    const [input, output] = extractTokens({});
    expect(input).toBe(0);
    expect(output).toBe(0);
  });

  it('zero values not treated as missing', () => {
    const [input, output] = extractTokens({
      prompt_tokens: 0,
      completion_tokens: 0,
      input_tokens: 99,
      output_tokens: 99,
    });
    expect(input).toBe(0);
    expect(output).toBe(0);
  });

  it('falls back to Anthropic style when OpenAI fields are undefined', () => {
    const [input, output] = extractTokens({
      prompt_tokens: undefined as unknown as number,
      completion_tokens: undefined as unknown as number,
      input_tokens: 20,
      output_tokens: 8,
    });
    expect(input).toBe(20);
    expect(output).toBe(8);
  });

  it('OpenAI style takes precedence', () => {
    const [input, output] = extractTokens({
      prompt_tokens: 10,
      completion_tokens: 5,
      input_tokens: 20,
      output_tokens: 8,
    });
    expect(input).toBe(10);
    expect(output).toBe(5);
  });
});

// ── collectFiles tests ────────────────────────────────────────────────────────

describe('collectFiles', () => {
  it('returns sorted relative paths', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'b.txt'), 'b');
    writeFileSync(join(dir, 'a.txt'), 'a');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'c.txt'), 'c');

    const result = collectFiles(dir, dir);
    expect(result).toEqual(['a.txt', 'b.txt', 'sub/c.txt']);
  });

  it('empty directory returns empty list', () => {
    const dir = tmpDir();
    expect(collectFiles(dir, dir)).toEqual([]);
  });

  it('truncates at limit and appends notice', () => {
    const dir = tmpDir();
    for (let i = 0; i < MAX_LISTED_FILES + 1; i++) {
      writeFileSync(join(dir, `file${i}.txt`), '');
    }

    const result = collectFiles(dir, dir);
    const notice = result[result.length - 1];
    const files = result.slice(0, -1);
    expect(files.length).toBe(MAX_LISTED_FILES);
    expect(notice).toContain(`truncated at ${MAX_LISTED_FILES}`);
  });

  it('skips symlinked file pointing outside workspace', () => {
    const outside = tmpDir();
    const secretPath = join(outside, 'secret.txt');
    writeFileSync(secretPath, 'secret');

    const workspace = tmpDir();
    writeFileSync(join(workspace, 'real.txt'), 'real');
    symlinkSync(secretPath, join(workspace, 'link.txt'));

    const result = collectFiles(workspace, workspace);
    expect(result).toEqual(['real.txt']);
  });

  it('does not follow symlinked directory', () => {
    const outsideDir = tmpDir();
    writeFileSync(join(outsideDir, 'secret.txt'), 'secret');

    const workspace = tmpDir();
    symlinkSync(outsideDir, join(workspace, 'linked_dir'));

    const result = collectFiles(workspace, workspace);
    expect(result).toEqual([]);
  });

  it('skips all EXCLUDED_DIRS entries', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'index.js'), 'real');
    for (const excluded of EXCLUDED_DIRS) {
      const sub = join(dir, excluded);
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, 'file.txt'), 'should be ignored');
    }

    const result = collectFiles(dir, dir);
    expect(result).toEqual(['index.js']);
  });
});

// ── buildMcpContext tests ──────────────────────────────────────────────────────

describe('buildMcpContext', () => {
  it('mentions having access to tools from registered MCP servers', () => {
    expect(buildMcpContext(['search_auth0_docs'])).toContain(
      'You have direct access to the following tools from the registered MCP server(s):',
    );
  });

  it('is wrapped in mcp_tools tags', () => {
    const ctx = buildMcpContext(['search_auth0_docs']);
    expect(ctx).toContain('<mcp_tools>');
    expect(ctx).toContain('</mcp_tools>');
  });

  it('returns empty string when no tools are provided', () => {
    expect(buildMcpContext()).toBe('');
    expect(buildMcpContext([])).toBe('');
  });
});

// ── run_agent system prompt tests ─────────────────────────────────────────────

describe('runAgent - system prompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('injects agent system prompt as system message', async () => {
    const capturedMessages: unknown[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { messages: unknown[] };
      capturedMessages.push(...body.messages);
      return {
        ok: true,
        json: async () => makeFinishResponse(),
      } as unknown as Response;
    });

    const dir = tmpDir();
    await runAgent('key', 'gpt-4o', makeTask('Use tools only.'), dir);

    const systemMsgs = capturedMessages.filter((m) => (m as Record<string, unknown>).role === 'system');
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
    expect((systemMsgs[0] as Record<string, unknown>).content).toContain('Use tools only');
  });

  it('includes mcp_tools context when tools includes mcp', async () => {
    const capturedMessages: unknown[] = [];
    mockClient.listTools.mockResolvedValue({
      tools: [{ name: 'search_auth0_docs', description: 'Search Auth0 docs', inputSchema: {} }],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { messages: unknown[] };
      capturedMessages.push(...body.messages);
      return {
        ok: true,
        json: async () => makeFinishResponse(),
      } as unknown as Response;
    });

    const dir = tmpDir();
    await runAgent('key', 'gpt-4o', makeTask('Use tools only.'), dir, {}, ['mcp']);

    const systemMsg = capturedMessages.find((m) => (m as Record<string, unknown>).role === 'system') as
      | Record<string, unknown>
      | undefined;
    expect(systemMsg?.content).toContain(
      'You have direct access to the following tools from the registered MCP server(s):',
    );
    expect(systemMsg?.content).toContain('<mcp_tools>');
  });

  it('omits mcp_tools context when tools does not include mcp', async () => {
    const capturedMessages: unknown[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { messages: unknown[] };
      capturedMessages.push(...body.messages);
      return {
        ok: true,
        json: async () => makeFinishResponse(),
      } as unknown as Response;
    });

    const dir = tmpDir();
    await runAgent('key', 'gpt-4o', makeTask('Use tools only.'), dir);

    const systemMsg = capturedMessages.find((m) => (m as Record<string, unknown>).role === 'system') as
      | Record<string, unknown>
      | undefined;
    expect(systemMsg?.content).not.toContain('<mcp_tools>');
  });

  it('omits system message when no agent system prompt', async () => {
    const capturedMessages: unknown[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { messages: unknown[] };
      capturedMessages.push(...body.messages);
      return {
        ok: true,
        json: async () => makeFinishResponse(),
      } as unknown as Response;
    });

    const dir = tmpDir();
    await runAgent('key', 'gpt-4o', makeTask(''), dir);

    const systemMsgs = capturedMessages.filter((m) => (m as Record<string, unknown>).role === 'system');
    expect(systemMsgs.length).toBe(0);
  });
});

// ── finish_task loop termination tests ────────────────────────────────────────

describe('runAgent - finish_task', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('terminates after finish_task', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => makeFinishResponse(),
      } as unknown as Response;
    });

    const dir = tmpDir();
    await runAgent('key', 'gpt-4o', makeTask(), dir);
    expect(callCount).toBe(1);
  });

  it('status is success on finish_task', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeFinishResponse(),
    } as unknown as Response);

    const dir = tmpDir();
    const record = await runAgent('key', 'gpt-4o', makeTask(), dir);
    expect(record.status).toBe('success');
  });

  it('captures finish_task summary', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeFinishResponse('Auth0 integration complete.'),
    } as unknown as Response);

    const dir = tmpDir();
    const record = await runAgent('key', 'gpt-4o', makeTask(), dir);
    expect(record.finalSummary).toContain('Auth0 integration complete');
  });

  it('counts finish_task as a tool call', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeFinishResponse(),
    } as unknown as Response);

    const dir = tmpDir();
    const record = await runAgent('key', 'gpt-4o', makeTask(), dir);
    expect(record.toolCalls.length).toBe(1);
    expect(record.toolCalls[0].name).toBe('finish_task');
  });

  it('terminates gracefully on empty tool calls', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeTextResponse('All done.'),
    } as unknown as Response);

    const dir = tmpDir();
    const record = await runAgent('key', 'gpt-4o', makeTask(), dir);
    expect(record.status).toBe('success');
    expect(record.finalSummary).toBe('All done.');
  });
});

// ── is_gemini_model tests ──────────────────────────────────────────────────────

describe('isGeminiModel', () => {
  it('detects gemini prefix', () => {
    expect(isGeminiModel('gemini-3-pro-preview')).toBe(true);
    expect(isGeminiModel('gemini-2.5-pro')).toBe(true);
  });

  it('returns false for non-gemini', () => {
    expect(isGeminiModel('gpt-4o')).toBe(false);
    expect(isGeminiModel('claude-sonnet-4-6')).toBe(false);
  });
});

// ── Gemini run_agent tests ─────────────────────────────────────────────────────

describe('runAgent - Gemini', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalises Gemini function_call response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: null,
              function_call: {
                name: 'finish_task',
                arguments: JSON.stringify({ summary: 'Gemini done.' }),
              },
            },
            finish_reason: 'function_call',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response);

    const dir = tmpDir();
    const record = await runAgent('key', 'gemini-3-pro-preview', makeTask(), dir);
    expect(record.status).toBe('success');
    expect(record.finalSummary).toContain('Gemini done');
  });

  it('sends role=function messages for Gemini tool results', async () => {
    const capturedMessages: unknown[][] = [];
    let callCount = 0;

    const readResponse = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: null,
            function_call: {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'src/App.js' }),
            },
          },
          finish_reason: 'function_call',
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    };

    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { messages: unknown[] };
      capturedMessages.push(body.messages);
      callCount++;
      return {
        ok: true,
        json: async () =>
          callCount === 1
            ? readResponse
            : {
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: null,
                      function_call: {
                        name: 'finish_task',
                        arguments: JSON.stringify({ summary: 'Done.' }),
                      },
                    },
                    finish_reason: 'function_call',
                  },
                ],
                usage: { prompt_tokens: 100, completion_tokens: 50 },
              },
      } as unknown as Response;
    });

    const dir = tmpDir();
    await runAgent('key', 'gemini-3-pro-preview', makeTask(), dir);

    const allMessages = capturedMessages.flat();
    const functionMsgs = allMessages.filter((m) => (m as Record<string, unknown>).role === 'function');
    expect(functionMsgs.length).toBe(1);
    expect((functionMsgs[0] as Record<string, unknown>).name).toBe('read_file');
  });
});

// ── detectRetry tests ──────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    name: 'run_command',
    args: { command: 'npm test' },
    result: '',
    startTime: 0,
    endTime: 1,
    isDocLookup: false,
    isInterruption: false,
    causedError: false,
    actionType: 'Implementation',
    isRetry: false,
    recoveredFromError: false,
    ...overrides,
  };
}

describe('detectRetry', () => {
  it('returns false when there are no prior calls', () => {
    expect(detectRetry([], 'run_command', { command: 'npm test' })).toBe(false);
  });

  it('returns true when the last matching call failed', () => {
    const history = [makeRecord({ causedError: true })];
    expect(detectRetry(history, 'run_command', { command: 'npm test' })).toBe(true);
  });

  it('returns false when the last matching call succeeded', () => {
    const history = [makeRecord({ causedError: false })];
    expect(detectRetry(history, 'run_command', { command: 'npm test' })).toBe(false);
  });

  it('returns false when prior call failed but a later matching call succeeded', () => {
    const history = [makeRecord({ causedError: true }), makeRecord({ causedError: false })];
    expect(detectRetry(history, 'run_command', { command: 'npm test' })).toBe(false);
  });

  it('returns true when prior call failed and only unrelated calls followed', () => {
    const history = [
      makeRecord({ causedError: true }),
      makeRecord({ name: 'read_file', args: { path: 'src/index.ts' }, causedError: false }),
      makeRecord({ name: 'read_file', args: { path: 'src/app.ts' }, causedError: false }),
    ];
    expect(detectRetry(history, 'run_command', { command: 'npm test' })).toBe(true);
  });

  it('returns false when a different primary arg failed', () => {
    const history = [makeRecord({ causedError: true, args: { command: 'npm install' } })];
    expect(detectRetry(history, 'run_command', { command: 'npm test' })).toBe(false);
  });

  it('returns false when a different tool failed with the same-looking args', () => {
    const history = [makeRecord({ name: 'write_file', causedError: true, args: { path: 'npm test' } })];
    expect(detectRetry(history, 'run_command', { command: 'npm test' })).toBe(false);
  });

  it('works for write_file using path as the primary arg', () => {
    const history = [
      makeRecord({ name: 'write_file', args: { path: 'src/index.ts', content: 'x' }, causedError: true }),
    ];
    expect(detectRetry(history, 'write_file', { path: 'src/index.ts', content: 'y' })).toBe(true);
  });
});

// ── ToolExecutor.search_auth0_docs tests ──────────────────────────────────────

describe('ToolExecutor.search_auth0_docs', () => {
  beforeEach(() => {
    mockClient.callTool.mockReset();
    mockClient.listTools.mockResolvedValue({
      tools: [{ name: 'search_auth0_docs', description: '', inputSchema: {} }],
    });
  });

  it('returns Unknown tool when initMcp has not been called', async () => {
    const executor = new ToolExecutor(tmpDir());
    const [result, , , isError] = await executor.execute('search_auth0_docs', { query: 'login' });
    expect(result).toContain('Unknown tool');
    expect(isError).toBe(true);
  });

  it('returns Unknown tool when tool name is not in the MCP tools list', async () => {
    mockClient.listTools.mockResolvedValue({
      tools: [{ name: 'other_tool', description: '', inputSchema: {} }],
    });
    const executor = new ToolExecutor(tmpDir());
    await executor.initMcp({ url: 'http://mcp', name: 'test', version: '1.0.0' });
    const [result, , , isError] = await executor.execute('search_auth0_docs', { query: 'login' });
    expect(result).toContain('Unknown tool');
    expect(isError).toBe(true);
  });

  it('returns result and marks as doc lookup', async () => {
    mockClient.callTool.mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'Auth0 login documentation' }],
    });
    const executor = new ToolExecutor(tmpDir());
    await executor.initMcp({ url: 'http://mcp', name: 'test', version: '1.0.0' });
    const [result, isDoc, isInterrupt, isError] = await executor.execute('search_auth0_docs', { query: 'login' });
    expect(result).toBe('Auth0 login documentation');
    expect(isDoc).toBe(true);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });

  it('passes query to callTool', async () => {
    mockClient.callTool.mockResolvedValue({ isError: false, content: [{ type: 'text', text: 'result' }] });
    const executor = new ToolExecutor(tmpDir());
    await executor.initMcp({ url: 'http://mcp', name: 'test', version: '1.0.0' });
    await executor.execute('search_auth0_docs', { query: 'quickstart react' });
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'search_auth0_docs',
      arguments: { query: 'quickstart react' },
    });
  });

  it('returns error string when callTool throws', async () => {
    mockClient.callTool.mockRejectedValue(new Error('network timeout'));
    const executor = new ToolExecutor(tmpDir());
    await executor.initMcp({ url: 'http://mcp', name: 'test', version: '1.0.0' });
    const [result, , , isError] = await executor.execute('search_auth0_docs', { query: 'anything' });
    expect(result).toContain('Error executing search_auth0_docs');
    expect(isError).toBe(true);
  });

  it('truncates results to 3000 chars', async () => {
    mockClient.callTool.mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'x'.repeat(5000) }],
    });
    const executor = new ToolExecutor(tmpDir());
    await executor.initMcp({ url: 'http://mcp', name: 'test', version: '1.0.0' });
    const [result] = await executor.execute('search_auth0_docs', { query: 'anything' });
    expect(result.length).toBeLessThanOrEqual(3000);
  });

  it('returns (no results) when response is empty', async () => {
    mockClient.callTool.mockResolvedValue({ isError: false, content: [{ type: 'text', text: '   ' }] });
    const executor = new ToolExecutor(tmpDir());
    await executor.initMcp({ url: 'http://mcp', name: 'test', version: '1.0.0' });
    const [result] = await executor.execute('search_auth0_docs', { query: 'anything' });
    expect(result).toBe('(no results)');
  });

  it('strips $schema from MCP tool inputSchema', async () => {
    mockClient.listTools.mockResolvedValue({
      tools: [
        {
          name: 'search_auth0_docs',
          description: 'Search docs',
          inputSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });
    const executor = new ToolExecutor(tmpDir());
    const { tools } = await executor.initMcp({ url: 'http://mcp', name: 'test', version: '1.0.0' });
    const fn = (tools[0] as { function: { parameters: Record<string, unknown> } }).function;
    expect(fn.parameters).not.toHaveProperty('$schema');
    expect(fn.parameters).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
  });
});

// ── runAgent MCP transport tests ──────────────────────────────────────────────

describe('runAgent - mcp transport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient.listTools.mockResolvedValue({ tools: [] });
    mockClient.callTool.mockReset();
  });

  it('passes a 30s AbortSignal timeout to the MCP transport', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeFinishResponse(),
    } as unknown as Response);

    const dir = tmpDir();
    await runAgent('key', 'gpt-4o', makeTask(), dir, {}, ['mcp']);
    const [, opts] = vi.mocked(StreamableHTTPClientTransport).mock.calls.at(-1)!;
    expect(opts?.requestInit?.signal).toBeInstanceOf(AbortSignal);
  });
});
