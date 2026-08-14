import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunResult } from '@netlify/axis';

// vi.mock factories are hoisted to the top of the file, so constants they
// reference must be declared with vi.hoisted() to be available at that point.
const { AGENT_LEVELS_FIXTURE, MOCK_TOOL_CALL } = vi.hoisted(() => ({
  // Complete AGENT_LEVELS set including L5 (version_correctness).
  AGENT_LEVELS_FIXTURE: new Set([
    'positive_presence',
    'hallucination',
    'security',
    'structural',
    'version_correctness',
  ]),
  MOCK_TOOL_CALL: { id: 'tc1', name: 'write_file', input: { path: 'src/App.jsx' } },
}));

vi.mock('@a0/evals-core', () => ({
  discoverEvals: vi.fn(),
  loadEval: vi.fn(),
  runGraders: vi.fn(),
  runCompileCommand: vi.fn(),
  runSetupCommand: vi.fn(),
  AGENT_LEVELS: AGENT_LEVELS_FIXTURE,
}));

vi.mock('../src/adapter.js', () => ({
  axisTranscriptToToolCalls: vi.fn(() => [MOCK_TOOL_CALL]),
}));

import { runAuth0Graders } from '../src/grader-hook.js';
import { discoverEvals, loadEval, runGraders, runCompileCommand, runSetupCommand } from '@a0/evals-core';
import { axisTranscriptToToolCalls } from '../src/adapter.js';
import type { EvalDefinition } from '@a0/evals-core';

const mockAxisTranscriptToToolCalls = vi.mocked(axisTranscriptToToolCalls);

const mockDiscoverEvals = vi.mocked(discoverEvals);
const mockLoadEval = vi.mocked(loadEval);
const mockRunGraders = vi.mocked(runGraders);
const mockRunCompileCommand = vi.mocked(runCompileCommand);
const mockRunSetupCommand = vi.mocked(runSetupCommand);

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    scenarioKey: 'react_quickstart',
    scenarioName: 'React Quickstart',
    agentName: 'claude-code',
    prompt: 'Add Auth0 login to a React app',
    judge: 'Did the agent succeed?',
    agentConfig: { agent: 'claude-code' },
    output: {
      transcript: [],
      result: null,
      metadata: { startTime: '', endTime: '', durationMs: 0, exitCode: 0 },
    },
    workingDirectory: '/tmp/workspace',
    ...overrides,
  };
}

const BASE_OPTIONS = {
  frameworkRoot: '/mock/auth0-evals',
  apiKey: 'test-api-key',
};

describe('runAuth0Graders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverEvals.mockReturnValue([
      {
        id: 'react_quickstart',
        name: 'React Quickstart',
        category: 'quickstarts',
        path: 'src/evals/quickstarts/react',
      },
    ]);
    mockLoadEval.mockResolvedValue({
      id: 'react_quickstart',
      name: 'React Quickstart',
      graders: [],
      compileCommand: undefined,
      setupCommand: undefined,
    } as unknown as EvalDefinition);
    mockRunGraders.mockResolvedValue([]);
  });

  it('throws when workingDirectory is missing', async () => {
    const result = makeResult({ workingDirectory: undefined });
    await expect(runAuth0Graders(result, BASE_OPTIONS)).rejects.toThrow('workingDirectory missing');
  });

  it('throws when no eval matches the scenarioKey', async () => {
    mockDiscoverEvals.mockReturnValue([]);
    await expect(runAuth0Graders(makeResult(), BASE_OPTIONS)).rejects.toThrow('No eval found');
  });

  it('calls discoverEvals with correct evalsDir and frameworkRoot', async () => {
    await runAuth0Graders(makeResult(), BASE_OPTIONS);
    expect(mockDiscoverEvals).toHaveBeenCalledWith('src/evals', '/mock/auth0-evals');
  });

  it('uses custom evalsDir when provided', async () => {
    await runAuth0Graders(makeResult(), { ...BASE_OPTIONS, evalsDir: 'custom/evals' });
    expect(mockDiscoverEvals).toHaveBeenCalledWith('custom/evals', '/mock/auth0-evals');
  });

  it('calls runGraders with workspace, apiKey, and tool calls', async () => {
    const transcript = [{ type: 'assistant' as const, timestamp: '', content: {} }];
    const graderResult = { name: 'auth0 provider present', kind: 'contains', passed: true, detail: '' };
    mockRunGraders.mockResolvedValue([graderResult]);

    const result = makeResult({
      output: { transcript, result: null, metadata: { startTime: '', endTime: '', durationMs: 0, exitCode: 0 } },
    });
    const results = await runAuth0Graders(result, BASE_OPTIONS);

    // Adapter receives the transcript and returns the mock tool call.
    expect(mockAxisTranscriptToToolCalls).toHaveBeenCalledWith(transcript);

    expect(mockRunGraders).toHaveBeenCalledWith(
      [],
      '/tmp/workspace',
      'test-api-key',
      undefined,
      AGENT_LEVELS_FIXTURE,
      true,
      [MOCK_TOOL_CALL],
      undefined,
      undefined,
    );
    expect(results).toEqual([graderResult]);
  });

  it('passes judgeModel when provided', async () => {
    await runAuth0Graders(makeResult(), { ...BASE_OPTIONS, judgeModel: 'claude-opus-5' });
    expect(mockRunGraders).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'test-api-key',
      'claude-opus-5',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      undefined,
    );
  });

  it('runs compile command when eval declares one', async () => {
    mockLoadEval.mockResolvedValue({
      id: 'react_quickstart',
      name: 'React Quickstart',
      graders: [],
      compileCommand: 'tsc --noEmit',
      setupCommand: undefined,
    } as unknown as EvalDefinition);
    mockRunCompileCommand.mockReturnValue({
      ok: true,
      exitCode: 0,
      signal: null,
      output: '',
      command: 'tsc --noEmit',
    });

    await runAuth0Graders(makeResult(), BASE_OPTIONS);

    expect(mockRunCompileCommand).toHaveBeenCalledWith('/tmp/workspace', 'tsc --noEmit', {
      setupCommand: undefined,
    });
  });

  it('skips compile command when eval has none', async () => {
    await runAuth0Graders(makeResult(), BASE_OPTIONS);
    expect(mockRunCompileCommand).not.toHaveBeenCalled();
  });

  it('runs setupCommand alone when eval has setup but no compile command', async () => {
    mockLoadEval.mockResolvedValue({
      id: 'react_quickstart',
      name: 'React Quickstart',
      graders: [],
      compileCommand: undefined,
      setupCommand: 'npm install',
    } as unknown as EvalDefinition);

    await runAuth0Graders(makeResult(), BASE_OPTIONS);

    expect(mockRunSetupCommand).toHaveBeenCalledWith('/tmp/workspace', 'npm install');
    expect(mockRunCompileCommand).not.toHaveBeenCalled();
  });

  it('skips setupCommand when eval has neither compile nor setup command', async () => {
    await runAuth0Graders(makeResult(), BASE_OPTIONS);

    expect(mockRunSetupCommand).not.toHaveBeenCalled();
    expect(mockRunCompileCommand).not.toHaveBeenCalled();
  });

  it('passes result.output.result as agentText when present', async () => {
    const result = makeResult({
      output: {
        transcript: [],
        result: 'Here is your integration: useAuth0() is the hook you need.',
        metadata: { startTime: '', endTime: '', durationMs: 0, exitCode: 0 },
      },
    });
    await runAuth0Graders(result, BASE_OPTIONS);
    expect(mockRunGraders).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      'Here is your integration: useAuth0() is the hook you need.',
    );
  });

  it('passes compile result into runGraders', async () => {
    const compileResult = { ok: false, exitCode: 1, signal: null, output: 'error', command: 'tsc' };
    mockLoadEval.mockResolvedValue({
      id: 'react_quickstart',
      name: 'React Quickstart',
      graders: [],
      compileCommand: 'tsc',
      setupCommand: undefined,
    } as unknown as EvalDefinition);
    mockRunCompileCommand.mockReturnValue(compileResult);

    await runAuth0Graders(makeResult(), BASE_OPTIONS);

    expect(mockRunGraders).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      compileResult,
      undefined,
    );
  });
});
