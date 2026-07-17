import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import './setup-config.js';
import { collectSkillContent } from '../src/recommendations/collect-skill-content.js';
import type { RecommendationInput } from '../src/recommendations/generator.js';
import type { RunRecord, ScoredResult } from '@a0/evals-core';

const tmpDir = makeTmpDir('recommendations_test_');

// ── collectSkillContent ─────────────────────────────────────────────────────

describe('collectSkillContent', () => {
  it('returns empty string when no skill dirs provided', () => {
    expect(collectSkillContent({})).toBe('');
  });

  it('returns empty string when all dirs are null', () => {
    expect(collectSkillContent({ 'auth0-react': null, 'auth0-express': null })).toBe('');
  });

  it('reads SKILL.md from a valid skill directory', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'SKILL.md'), '# Auth0 React Skill\nSome content');

    const result = collectSkillContent({ 'auth0-react': dir });
    expect(result).toContain('## Skill: auth0-react');
    expect(result).toContain('# Auth0 React Skill');
    expect(result).toContain('Some content');
  });

  it('reads references/*.md files', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'SKILL.md'), '# Skill');
    mkdirSync(join(dir, 'references'));
    writeFileSync(join(dir, 'references', 'setup.md'), 'Setup instructions');
    writeFileSync(join(dir, 'references', 'api.md'), 'API reference');

    const result = collectSkillContent({ 'my-skill': dir });
    expect(result).toContain('### my-skill/references/setup.md');
    expect(result).toContain('Setup instructions');
    expect(result).toContain('### my-skill/references/api.md');
    expect(result).toContain('API reference');
  });

  it('ignores non-.md files in references/', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'SKILL.md'), '# Skill');
    mkdirSync(join(dir, 'references'));
    writeFileSync(join(dir, 'references', 'data.json'), '{}');
    writeFileSync(join(dir, 'references', 'notes.md'), 'Notes');

    const result = collectSkillContent({ skill: dir });
    expect(result).toContain('notes.md');
    expect(result).not.toContain('data.json');
  });

  it('handles multiple skills', () => {
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    writeFileSync(join(dir1, 'SKILL.md'), 'Skill A');
    writeFileSync(join(dir2, 'SKILL.md'), 'Skill B');

    const result = collectSkillContent({ 'skill-a': dir1, 'skill-b': dir2 });
    expect(result).toContain('## Skill: skill-a');
    expect(result).toContain('## Skill: skill-b');
    expect(result).toContain('Skill A');
    expect(result).toContain('Skill B');
  });

  it('skips skills with missing SKILL.md gracefully', () => {
    const dir = tmpDir();
    // No SKILL.md created

    const result = collectSkillContent({ 'empty-skill': dir });
    expect(result).toBe('');
  });
});

// ── generateRecommendations ─────────────────────────────────────────────────

describe('generateRecommendations', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeInput(workspace: string): RecommendationInput {
    const record: RunRecord = {
      taskName: 'test_eval',
      model: 'test-model',
      sessionId: 'sess-1',
      startTime: 0,
      endTime: 10000,
      toolCalls: [
        {
          name: 'write_file',
          args: { path: 'src/App.tsx' },
          result: 'ok',
          startTime: 0,
          endTime: 1000,
          isDocLookup: false,
          isInterruption: false,
          causedError: false,
          actionType: 'implementation',
          isRetry: false,
          recoveredFromError: false,
        },
      ],
      turnMetrics: [],
      providerErrors: [],
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.01,
      status: 'success',
      finalSummary: 'Done',
      workspace,
    };

    const scored: ScoredResult = {
      runRecord: record,
      dimensions: [
        { name: 'Correctness', weight: 0.25, rawScore: 90, grade: 'A', notes: '', weighted: 22.5 },
        { name: 'Efficiency', weight: 0.14, rawScore: 100, grade: 'A', notes: '', weighted: 14 },
      ],
      overallScore: 90,
      overallGrade: 'A',
      graderResults: [
        {
          name: 'has Auth0Provider',
          kind: 'contains',
          passed: true,
          detail: 'found',
          level: 'positive_presence' as never,
        },
        {
          name: 'no hardcoded secrets',
          kind: 'not_contains',
          passed: true,
          detail: 'not found',
          level: 'security' as never,
        },
      ],
      graderPassRate: 1.0,
    };

    return {
      evalId: 'react_quickstart',
      model: 'test-model',
      tools: ['skills'],
      userPrompt: 'Add Auth0 login to the React app',
      workspace,
      scored,
      record,
      skillContent: '## Skill: auth0-react\n# Auth0 React SDK',
      apiKey: 'test-key',
      baseUrl: 'https://example.com',
      judgeModel: 'claude-sonnet-4-5',
    };
  }

  it('returns parsed recommendations on successful LLM response', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'App.tsx'), 'export default function App() {}');

    const llmResponse = JSON.stringify({
      recommendations: [
        {
          category: 'skill',
          severity: 'medium',
          issue: 'Missing audience docs',
          suggestion: 'Add audience parameter to Quick Start',
          context: 'SKILL.md Step 3',
        },
      ],
      summary: 'The skill docs could highlight the audience parameter more prominently.',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: llmResponse } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result).toBeDefined();
    expect(result!.eval_id).toBe('react_quickstart');
    expect(result!.model).toBe('test-model');
    expect(result!.tools).toEqual(['skills']);
    expect(result!.recommendations).toHaveLength(1);
    expect(result!.recommendations[0].category).toBe('skill');
    expect(result!.recommendations[0].severity).toBe('medium');
    expect(result!.recommendations[0].issue).toBe('Missing audience docs');
    expect(result!.summary).toContain('audience parameter');
  });

  it('handles JSON wrapped in markdown code fences', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    const llmResponse =
      '```json\n' +
      JSON.stringify({
        recommendations: [{ category: 'grader', severity: 'low', issue: 'test', suggestion: 'fix' }],
        summary: 'A summary.',
      }) +
      '\n```';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: llmResponse } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result).toBeDefined();
    expect(result!.recommendations).toHaveLength(1);
    expect(result!.recommendations[0].category).toBe('grader');
  });

  it('returns undefined on API error', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result).toBeUndefined();
  });

  it('returns undefined on invalid JSON response', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not valid json at all' } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result).toBeUndefined();
  });

  it('returns undefined when response is missing recommendations array', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"summary": "no recs"}' } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result).toBeUndefined();
  });

  it('filters out malformed recommendation items', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    const llmResponse = JSON.stringify({
      recommendations: [
        { category: 'skill', severity: 'high', issue: 'valid', suggestion: 'fix it' },
        { category: 'grader' }, // missing issue and suggestion
        'not an object',
        null,
      ],
      summary: 'Summary',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: llmResponse } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result).toBeDefined();
    expect(result!.recommendations).toHaveLength(1);
    expect(result!.recommendations[0].issue).toBe('valid');
  });

  it('sends correct request to LLM endpoint', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ recommendations: [], summary: '' }) } }],
      }),
    });
    globalThis.fetch = fetchMock;

    await generateRecommendations(makeInput(dir));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/chat/completions');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer test-key');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('react_quickstart');
    expect(body.messages[1].content).toContain('Add Auth0 login');
  });

  it('returns undefined on network failure', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await generateRecommendations(makeInput(dir));
    expect(result).toBeUndefined();
  });

  it('sends the model alias as-is, ignoring the Bedrock modelIds map', async () => {
    // The modelIds map holds Bedrock IDs for the agent runner's /anthropic
    // endpoint. Recommendations hit the /chat/completions endpoint, which serves
    // models under their plain alias — so even when a Bedrock map is configured,
    // the alias must be sent unchanged (regression: applying the map here
    // produced model="global.anthropic.claude-opus-4-8" → 400).
    const { setFrameworkConfig } = await import('@a0/evals-core');
    const { TEST_CONFIG } = await import('./test-config.js');
    setFrameworkConfig({
      ...TEST_CONFIG,
      models: {
        ...TEST_CONFIG.models,
        modelIds: { 'claude-sonnet-4-6': 'global.anthropic.claude-sonnet-4-6' },
      },
    });

    try {
      const { generateRecommendations } = await import('../src/recommendations/generator.js');
      const dir = tmpDir();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ recommendations: [], summary: '' }) } }],
        }),
      });
      globalThis.fetch = fetchMock;

      const input = makeInput(dir);
      input.judgeModel = 'claude-sonnet-4-6';
      await generateRecommendations(input);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('claude-sonnet-4-6');
    } finally {
      setFrameworkConfig(TEST_CONFIG);
    }
  });

  it('truncates workspace files at MAX_WORKSPACE_CHARS', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'a'.repeat(10_000));
    writeFileSync(join(dir, 'src', 'b.ts'), 'b'.repeat(10_000));
    writeFileSync(join(dir, 'src', 'c.ts'), 'c'.repeat(10_000)); // pushes past 24k

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ recommendations: [], summary: '' }) } }],
      }),
    });
    globalThis.fetch = fetchMock;

    await generateRecommendations(makeInput(dir));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userContent: string = body.messages[1].content;
    // At least one file should be excluded due to the 24k char limit
    const fileCount = (userContent.match(/<workspace_file/g) || []).length;
    expect(fileCount).toBeLessThan(3);
    expect(fileCount).toBeGreaterThan(0);
  });

  it('sorts recommendations high before medium before low', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    const llmResponse = JSON.stringify({
      recommendations: [
        { category: 'efficiency', severity: 'low', issue: 'low issue', suggestion: 'fix' },
        { category: 'grader', severity: 'high', issue: 'high issue', suggestion: 'fix' },
        { category: 'skill', severity: 'medium', issue: 'medium issue', suggestion: 'fix' },
      ],
      summary: 'Summary',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: llmResponse } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result).toBeDefined();
    expect(result!.recommendations).toHaveLength(3);
    expect(result!.recommendations[0].severity).toBe('high');
    expect(result!.recommendations[1].severity).toBe('medium');
    expect(result!.recommendations[2].severity).toBe('low');
  });

  it('excludes .env files from the LLM prompt', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, '.env'), 'AUTH0_CLIENT_SECRET=super-secret');
    writeFileSync(join(dir, '.env.local'), 'AUTH0_SECRET=also-secret');
    writeFileSync(join(dir, 'src', 'app.ts'), 'console.log("hello")');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ recommendations: [], summary: '' }) } }],
      }),
    });
    globalThis.fetch = fetchMock;

    await generateRecommendations(makeInput(dir));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userContent: string = body.messages[1].content;
    expect(userContent).not.toContain('super-secret');
    expect(userContent).not.toContain('also-secret');
    expect(userContent).toContain('app.ts');
  });
});
