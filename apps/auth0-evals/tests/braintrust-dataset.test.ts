/**
 * Tests for src/reporters/braintrust-dataset.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toEvalSummaries } from '../src/reporters/braintrust-dataset.js';

// ── toEvalSummaries ──────────────────────────────────────────────────────────

describe('toEvalSummaries', () => {
  it('maps evaluation definitions to summaries', () => {
    const defs = [
      {
        id: 'react_quickstart',
        category: 'quickstarts',
        userPrompt: 'Add Auth0 login.',
        scaffold: { 'src/App.js': 'code', 'src/index.js': 'code' },
        graders: [{}, {}, {}],
        skills: ['auth0-react'],
      },
    ];

    const summaries = toEvalSummaries(defs);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('react_quickstart');
    expect(summaries[0].category).toBe('quickstarts');
    expect(summaries[0].prompt).toBe('Add Auth0 login.');
    expect(summaries[0].scaffoldFiles).toEqual(['src/App.js', 'src/index.js']);
    expect(summaries[0].graderCount).toBe(3);
    expect(summaries[0].skills).toEqual(['auth0-react']);
  });

  it('handles empty scaffold and skills', () => {
    const defs = [
      {
        id: 'test',
        category: 'test',
        userPrompt: 'prompt',
        scaffold: {},
        graders: [],
        skills: [],
      },
    ];

    const summaries = toEvalSummaries(defs);

    expect(summaries[0].scaffoldFiles).toEqual([]);
    expect(summaries[0].graderCount).toBe(0);
    expect(summaries[0].skills).toEqual([]);
  });

  it('handles multiple definitions', () => {
    const defs = [
      { id: 'a', category: 'c', userPrompt: 'p', scaffold: {}, graders: [{}], skills: [] },
      { id: 'b', category: 'c', userPrompt: 'p', scaffold: {}, graders: [{}, {}], skills: [] },
    ];

    const summaries = toEvalSummaries(defs);

    expect(summaries).toHaveLength(2);
    expect(summaries[0].graderCount).toBe(1);
    expect(summaries[1].graderCount).toBe(2);
  });
});

// ── syncDataset ──────────────────────────────────────────────────────────────

describe('syncDataset', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.BRAINTRUST_API_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    if (savedKey !== undefined) process.env.BRAINTRUST_API_KEY = savedKey;
    else delete process.env.BRAINTRUST_API_KEY;
  });

  it('returns null when BRAINTRUST_API_KEY is not set', async () => {
    delete process.env.BRAINTRUST_API_KEY;
    const { syncDataset } = await import('../src/reporters/braintrust-dataset.js');
    const result = await syncDataset([]);
    expect(result).toBeNull();
  });

  it('calls initDataset and inserts records when key is set', async () => {
    process.env.BRAINTRUST_API_KEY = 'test-key';
    const mockInsert = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockClose = vi.fn().mockResolvedValue(undefined);
    vi.doMock('braintrust', () => ({
      initDataset: vi.fn().mockReturnValue({
        insert: mockInsert,
        flush: mockFlush,
        close: mockClose,
      }),
    }));

    const { syncDataset } = await import('../src/reporters/braintrust-dataset.js');
    const result = await syncDataset([
      { id: 'test', category: 'cat', prompt: 'p', scaffoldFiles: ['a.ts'], graderCount: 5, skills: ['s1'] },
    ]);

    expect(result).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith({
      id: 'test',
      input: { eval_id: 'test', prompt: 'p', category: 'cat', scaffold_files: ['a.ts'] },
      metadata: { grader_count: 5, skills: ['s1'] },
    });
    expect(mockFlush).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it('returns null when initDataset throws', async () => {
    process.env.BRAINTRUST_API_KEY = 'test-key';
    vi.doMock('braintrust', () => ({
      initDataset: vi.fn().mockImplementation(() => {
        throw new Error('dataset error');
      }),
    }));

    const { syncDataset } = await import('../src/reporters/braintrust-dataset.js');
    const result = await syncDataset([]);
    expect(result).toBeNull();
  });
});
