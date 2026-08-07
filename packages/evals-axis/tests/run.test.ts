import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunResult, ScoredOutput } from '@netlify/axis';

vi.mock('@netlify/axis', () => ({
  run: vi.fn(),
  scoreResults: vi.fn(),
}));

vi.mock('../src/grader-hook.js', () => ({
  runAuth0Graders: vi.fn(),
}));

import { runAxis } from '../src/run.js';
import { run, scoreResults } from '@netlify/axis';
import { runAuth0Graders } from '../src/grader-hook.js';

const mockRun = vi.mocked(run);
const mockScoreResults = vi.mocked(scoreResults);
const mockRunAuth0Graders = vi.mocked(runAuth0Graders);

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    scenarioKey: 'react_quickstart',
    scenarioName: 'React Quickstart',
    agentName: 'claude-code|global.anthropic.claude-opus-4-8',
    prompt: 'Add Auth0 login to my React app.',
    judge: 'Did it work?',
    agentConfig: { agent: 'claude-code' },
    output: {
      transcript: [],
      result: 'Done.',
      metadata: { startTime: '', endTime: '', durationMs: 1000, exitCode: 0 },
    },
    ...overrides,
  };
}

function makeScoredOutput(result: RunResult): ScoredOutput {
  return {
    version: '1',
    timestamp: '2026-01-01T00:00:00Z',
    durationMs: 1000,
    summary: { total: 1, completed: 1, failed: 0 },
    results: [
      {
        ...result,
        score: {
          axisScore: 80,
          goalAchievement: { score: 80 },
          environment: { score: 90 },
          service: { score: 100 },
          agent: { score: 85 },
          weights: {} as never,
        },
      },
    ],
  } as unknown as ScoredOutput;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runAxis', () => {
  it('collects grader results under scenarioKey|agentName key', async () => {
    const result = makeRunResult();
    const graders = [{ name: 'Uses SDK', kind: 'contains', passed: true, detail: 'found' }];

    // Simulate AXIS calling onResult for each job.
    mockRun.mockImplementation(async (opts) => {
      await opts.onResult?.(result);
      return {
        version: '1',
        timestamp: '2026-01-01T00:00:00Z',
        durationMs: 1000,
        summary: { total: 1, completed: 1, failed: 0 },
        results: [result],
      };
    });
    mockRunAuth0Graders.mockResolvedValue(graders);
    mockScoreResults.mockResolvedValue(makeScoredOutput(result));

    const { graderResults } = await runAxis({ frameworkRoot: '/tmp', apiKey: 'key' });

    expect(graderResults.get('react_quickstart|claude-code|global.anthropic.claude-opus-4-8')).toEqual(graders);
  });

  it('returns scoredOutput from scoreResults', async () => {
    const result = makeRunResult();
    const scored = makeScoredOutput(result);

    mockRun.mockImplementation(async (opts) => {
      await opts.onResult?.(result);
      return {
        version: '1',
        timestamp: '2026-01-01T00:00:00Z',
        durationMs: 1000,
        summary: { total: 1, completed: 1, failed: 0 },
        results: [result],
      };
    });
    mockRunAuth0Graders.mockResolvedValue([]);
    mockScoreResults.mockResolvedValue(scored);

    const { scoredOutput } = await runAxis({ frameworkRoot: '/tmp', apiKey: 'key' });

    expect(scoredOutput).toBe(scored);
  });

  it('stores a grading-error entry when runAuth0Graders rejects', async () => {
    const result = makeRunResult();
    const onGraderResults = vi.fn();

    mockRun.mockImplementation(async (opts) => {
      await opts.onResult?.(result);
      return {
        version: '1',
        timestamp: '2026-01-01T00:00:00Z',
        durationMs: 1000,
        summary: { total: 1, completed: 1, failed: 0 },
        results: [result],
      };
    });
    mockRunAuth0Graders.mockRejectedValue(new Error('workspace not found'));
    mockScoreResults.mockResolvedValue(makeScoredOutput(result));

    const { graderResults, scoredOutput } = await runAxis({
      frameworkRoot: '/tmp',
      apiKey: 'key',
      onGraderResults,
    });

    const key = 'react_quickstart|claude-code|global.anthropic.claude-opus-4-8';
    const stored = graderResults.get(key);
    expect(stored).toHaveLength(1);
    expect(stored?.[0].passed).toBe(false);
    expect(stored?.[0].name).toBe('grading-error');
    expect(stored?.[0].detail).toContain('workspace not found');

    // onGraderResults is called with the error entry so callers can surface it.
    expect(onGraderResults).toHaveBeenCalledWith(
      'react_quickstart',
      'claude-code|global.anthropic.claude-opus-4-8',
      stored,
    );

    // Scoring still completes despite the grading failure.
    expect(scoredOutput.summary.completed).toBe(1);
  });

  it('calls onGraderResults callback with scenarioKey, agentName, and results', async () => {
    const result = makeRunResult();
    const graders = [{ name: 'Uses SDK', kind: 'contains', passed: true, detail: 'found' }];
    const onGraderResults = vi.fn();

    mockRun.mockImplementation(async (opts) => {
      await opts.onResult?.(result);
      return {
        version: '1',
        timestamp: '',
        durationMs: 0,
        summary: { total: 1, completed: 1, failed: 0 },
        results: [result],
      };
    });
    mockRunAuth0Graders.mockResolvedValue(graders);
    mockScoreResults.mockResolvedValue(makeScoredOutput(result));

    await runAxis({ frameworkRoot: '/tmp', apiKey: 'key', onGraderResults });

    expect(onGraderResults).toHaveBeenCalledWith(
      'react_quickstart',
      'claude-code|global.anthropic.claude-opus-4-8',
      graders,
    );
  });

  it('calls onAxisScore callback with scenarioKey, agentName, and score', async () => {
    const result = makeRunResult();
    const scored = makeScoredOutput(result);
    const onAxisScore = vi.fn();

    mockRun.mockImplementation(async () => ({
      version: '1',
      timestamp: '',
      durationMs: 0,
      summary: { total: 1, completed: 1, failed: 0 },
      results: [result],
    }));
    mockRunAuth0Graders.mockResolvedValue([]);
    mockScoreResults.mockResolvedValue(scored);

    await runAxis({ frameworkRoot: '/tmp', apiKey: 'key', onAxisScore });

    expect(onAxisScore).toHaveBeenCalledWith(
      'react_quickstart',
      'claude-code|global.anthropic.claude-opus-4-8',
      scored.results[0].score,
    );
  });

  it('strips workingDirectory before passing results to scoreResults', async () => {
    const result = makeRunResult({ workingDirectory: '/tmp/workspace' });

    mockRun.mockImplementation(async () => ({
      version: '1',
      timestamp: '2026-01-01T00:00:00Z',
      durationMs: 1000,
      summary: { total: 1, completed: 1, failed: 0 },
      results: [result],
    }));
    mockRunAuth0Graders.mockResolvedValue([]);
    mockScoreResults.mockResolvedValue(makeScoredOutput(result));

    await runAxis({ frameworkRoot: '/tmp', apiKey: 'key' });

    const passedToScorer = mockScoreResults.mock.calls[0][0];
    expect(passedToScorer.results[0].workingDirectory).toBeUndefined();
  });
});
