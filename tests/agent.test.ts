/**
 * Tests for src/agent_eval/agent.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractTokens,
  summariseArgs,
  isGeminiModel,
  llmCall,
  runAgent,
  detectRetry,
  type ToolCallRecord,
} from '../src/agent_eval/agent.js';
import { TOOL_DEFINITIONS } from '../src/agent_eval/tools/index.js';
import { collectFiles } from '../src/agent_eval/tools/utils.js';

import { ToolExecutor } from '../src/agent_eval/tools-executor/index.js';
import { EXCLUDED_DIRS, MAX_LISTED_FILES } from '../src/config/settings.js';

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

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent_test_'));
}

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
  it('returns summary', () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result, isDoc, isInterrupt, isError] = executor.execute('finish_task', { summary: 'Done.' });
    expect(result).toBe('Done.');
    expect(isDoc).toBe(false);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });

  it('returns default when no summary', () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('finish_task', {});
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
    const outside = mkdtempSync(join(tmpdir(), 'outside_'));
    const secretPath = join(outside, 'secret.txt');
    writeFileSync(secretPath, 'secret');

    const workspace = tmpDir();
    writeFileSync(join(workspace, 'real.txt'), 'real');
    symlinkSync(secretPath, join(workspace, 'link.txt'));

    const result = collectFiles(workspace, workspace);
    expect(result).toEqual(['real.txt']);
  });

  it('does not follow symlinked directory', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'outside_dir_'));
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

// ── ToolExecutor.write_file tests ─────────────────────────────────────────────

describe('ToolExecutor.write_file', () => {
  it('writes a file within the workspace', () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('write_file', { path: 'output.txt', content: 'hello' });
    expect(result).toContain('Written');
    expect(result).toContain('output.txt');
  });

  it('rejects path traversal', () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('write_file', { path: '../../evil.txt', content: 'bad' });
    expect(result).toContain('Access denied');
  });

  it('rejects symlink pointing outside workspace', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside_'));
    writeFileSync(join(outside, 'target.txt'), 'original');
    const dir = tmpDir();
    symlinkSync(join(outside, 'target.txt'), join(dir, 'link.txt'));
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('write_file', { path: 'link.txt', content: 'overwrite' });
    expect(result).toContain('Access denied');
  });
});

// ── ToolExecutor._read_file safety tests ─────────────────────────────────────

describe('ToolExecutor.read_file', () => {
  it('rejects path traversal', () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('read_file', { path: '../../etc/passwd' });
    expect(result).toContain('Access denied');
  });

  it('returns error for directory', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'));
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('read_file', { path: 'src' });
    expect(result).toContain('list_files');
  });

  it('returns error for workspace root', () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('read_file', { path: '' });
    expect(result).toContain('list_files');
  });
});

// ── ToolExecutor.list_files tests ─────────────────────────────────────────────

describe('ToolExecutor.list_files', () => {
  it('rejects path traversal', () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('list_files', { path: '../../etc' });
    expect(result).toContain('Access denied');
  });

  it('returns directory listing for subdir', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export {}');
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('list_files', { path: 'src' });
    expect(result).toContain('Directory listing');
    expect(result).toContain('src/index.ts');
  });

  it('returns listing for workspace root', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'README.md'), '# hello');
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('list_files', { path: '' });
    expect(result).toContain('Directory listing');
    expect(result).toContain('README.md');
  });

  it('returns error for file path', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'main.py'), "print('hi')");
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('list_files', { path: 'main.py' });
    expect(result).toContain('read_file');
  });

  it('returns error for missing directory', () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = executor.execute('list_files', { path: 'nonexistent' });
    expect(result.toLowerCase()).toContain('not found');
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
    expect(isGeminiModel('claude-4-6-sonnet')).toBe(false);
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
