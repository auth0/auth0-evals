import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import './setup-config.js';
import { collectSkillContent, collectSkillFiles } from '../src/recommendations/collect-skill-content.js';
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

  it('reads references stored as directories', () => {
    // The auth0 skill keeps each reference in its own directory, so a flat
    // readdir for `*.md` matches nothing and the whole pool goes missing.
    const dir = tmpDir();
    writeFileSync(join(dir, 'SKILL.md'), '# Router');
    mkdirSync(join(dir, 'references', 'feature-mfa'), { recursive: true });
    writeFileSync(join(dir, 'references', 'feature-mfa', 'index.md'), 'MFA hub');
    writeFileSync(join(dir, 'references', 'feature-mfa', 'enrollment.md'), 'MFA leaf');

    const result = collectSkillContent({ auth0: dir });
    expect(result).toContain('### auth0/references/feature-mfa/index.md');
    expect(result).toContain('MFA hub');
    expect(result).toContain('MFA leaf');
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

  it('does not throw when the references path is unreadable', () => {
    // Recommendations run for every job and must never throw (generateRunRecommendations
    // calls this outside generateRecommendations' try/catch), so an IO fault while
    // walking references has to degrade to less content rather than an exception.
    // A `references` file where a directory is expected makes readdirSync throw ENOTDIR.
    const dir = tmpDir();
    writeFileSync(join(dir, 'SKILL.md'), '# Router');
    writeFileSync(join(dir, 'references'), 'not a directory');

    let files;
    expect(() => {
      files = collectSkillFiles({ auth0: dir });
    }).not.toThrow();
    // The readable SKILL.md still comes back; only the unreadable walk is skipped.
    expect(files).toEqual([{ skill: 'auth0', relPath: 'SKILL.md', content: '# Router' }]);
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

  // A reply that quotes a command as evidence opens with a ```bash fence; taking the
  // first fence would lose every finding to `Unexpected token 'b', "bash\nauth"`.
  it('finds the JSON when an earlier fence quotes a command', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    const llmResponse =
      'The run piped the banner into jq:\n\n' +
      '```bash\nauth0 api get "tenants/settings" 2>&1 | jq -r .default_redirection_uri\n```\n\n' +
      '```json\n' +
      JSON.stringify({
        recommendations: [{ category: 'skill', severity: 'high', issue: 'redirects stderr', suggestion: 'drop 2>&1' }],
        summary: 'A summary.',
      }) +
      '\n```';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: llmResponse } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result.error).toBeUndefined();
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].issue).toBe('redirects stderr');
  });

  // Prose around the JSON with no fence at all: the braces are the only marker left.
  it('finds the JSON when the reply wraps it in prose', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    const llmResponse =
      'Here is the analysis:\n' +
      JSON.stringify({
        recommendations: [{ category: 'cli', severity: 'low', issue: 'x', suggestion: 'y' }],
        summary: 'S.',
      }) +
      '\nLet me know if you want more detail.';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: llmResponse } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result.error).toBeUndefined();
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].category).toBe('cli');
  });

  // A failed analysis comes back carrying its reason rather than as undefined: an
  // empty list with no explanation renders as "this run was clean", which is the
  // opposite of what a 500 means.
  it('reports the reason on API error', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result.error).toContain('500');
    expect(result.recommendations).toEqual([]);
    expect(result.eval_id).toBe('react_quickstart');
    expect(result.model).toBe('test-model');
  });

  it('reports the reason on invalid JSON response', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not valid json at all' } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result.error).toBeTruthy();
    expect(result.recommendations).toEqual([]);
  });

  it('reports the reason when response is missing recommendations array', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"summary": "no recs"}' } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result.error).toContain('recommendations array');
    expect(result.recommendations).toEqual([]);
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

  it('reports the reason on network failure', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await generateRecommendations(makeInput(dir));
    expect(result.error).toContain('network error');
    expect(result.recommendations).toEqual([]);
  });

  it('masks credential values before the run trace leaves the machine', async () => {
    // The trace is posted to the proxy, so a CLI eval that puts a client secret on
    // the command line would otherwise ship it off-box on every analysis.
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();
    const input = makeInput(dir);
    input.record.toolCalls.push({
      name: 'run_command',
      args: {
        command: 'auth0 api post clients --client-secret fixture_not_a_real_secret_abcdefghijklmnopqrstuvwxyz012345',
      },
      result: 'ok',
      startTime: 2000,
      endTime: 2500,
      isDocLookup: false,
      isInterruption: false,
      causedError: false,
      actionType: 'implementation',
      isRetry: false,
      recoveredFromError: false,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ recommendations: [], summary: '' }) } }],
      }),
    });
    globalThis.fetch = fetchMock;

    await generateRecommendations(input);

    const userContent: string = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content;
    expect(userContent).not.toContain('fixture_not_a_real_secret_abcdefghijklmnopqrstuvwxyz012345');
    expect(userContent).toContain('[REDACTED SECRET]');
    // The command itself still has to be readable, or the diagnosis loses its subject.
    expect(userContent).toContain('auth0 api post clients');
  });

  it('sends the model alias as-is, ignoring the Bedrock modelIds map', async () => {
    // The modelIds map holds Bedrock IDs for the agent runner's /anthropic
    // endpoint. Recommendations hit the /chat/completions endpoint, which serves
    // models under their plain alias — so even when a Bedrock map is configured,
    // the alias must be sent unchanged (regression: applying the map here
    // produced model="global.anthropic.claude-opus-5" → 400).
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

  it('puts failed commands and their error text in the run trace', async () => {
    // Aggregate counts ("errors: 1") cannot tell an analyst which command failed or
    // why, and for a CLI eval the commands are the entire artifact.
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();
    const input = makeInput(dir);
    input.record.toolCalls.push({
      name: 'run_command',
      args: { command: 'auth0 orgs members add acme --members user_1' },
      result: 'Error: unknown flag: --members',
      startTime: 1000,
      endTime: 1500,
      isDocLookup: false,
      isInterruption: false,
      causedError: true,
      actionType: 'implementation',
      isRetry: false,
      recoveredFromError: true,
      errorCategory: 'invalid_usage' as never,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ recommendations: [], summary: '' }) } }],
      }),
    });
    globalThis.fetch = fetchMock;

    await generateRecommendations(input);

    const userContent: string = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content;
    expect(userContent).toContain('auth0 orgs members add acme --members user_1');
    expect(userContent).toContain('unknown flag: --members');
    expect(userContent).toContain('invalid_usage');
    // A successful write_file carries no diagnostic signal — the workspace listing
    // already shows what it produced.
    expect(userContent).not.toContain('[ok] write_file');
  });

  it('disables thinking so the JSON body is not truncated', async () => {
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

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBeGreaterThan(2048);
  });

  it('keeps the diagnosis fields and drops an unrecognised root_cause', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();

    const llmResponse = JSON.stringify({
      recommendations: [
        {
          category: 'skill',
          severity: 'high',
          root_cause: 'skill',
          issue: 'The skill documents a flag the CLI does not accept',
          what_happened: 'The agent ran `auth0 orgs members add --members`, which failed.',
          what_should_have_happened: 'Members are added through `auth0 api post`.',
          evidence: 'Error: unknown flag: --members',
          suggestion: 'Correct the example in references/feature-organizations/index.md',
          context: 'references/feature-organizations/index.md',
        },
        {
          category: 'grader',
          severity: 'low',
          root_cause: 'not-a-cause',
          issue: 'still a valid finding',
          suggestion: 'fix',
        },
      ],
      summary: 'One skill defect.',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: llmResponse } }] }),
    });

    const result = await generateRecommendations(makeInput(dir));
    expect(result!.recommendations).toHaveLength(2);
    const [skillRec, graderRec] = result!.recommendations;
    expect(skillRec.root_cause).toBe('skill');
    expect(skillRec.what_happened).toContain('--members');
    expect(skillRec.what_should_have_happened).toContain('auth0 api post');
    expect(skillRec.evidence).toBe('Error: unknown flag: --members');
    expect(graderRec.root_cause).toBeUndefined();
    expect(graderRec.issue).toBe('still a valid finding');
  });

  it('sends the references the agent opened and lists the ones it did not', async () => {
    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const dir = tmpDir();
    const input = makeInput(dir);
    input.skillContent = '';
    input.record.toolCalls.push({
      name: 'read_file',
      args: { path: '/skills/auth0/references/feature-organizations/index.md' },
      result: 'ok',
      startTime: 1000,
      endTime: 1100,
      isDocLookup: true,
      isInterruption: false,
      causedError: false,
      actionType: 'exploration',
      isRetry: false,
      recoveredFromError: false,
    });
    // Two references, both far past the budget on their own: the one the agent
    // opened has to win the space, and the other still has to be named.
    input.skillFiles = [
      { skill: 'auth0', relPath: 'SKILL.md', content: '# Router' },
      { skill: 'auth0', relPath: 'references/feature-mfa/index.md', content: `MFA ${'x'.repeat(30_000)}` },
      {
        skill: 'auth0',
        relPath: 'references/feature-organizations/index.md',
        content: `ORGS ${'y'.repeat(30_000)}`,
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ recommendations: [], summary: '' }) } }],
      }),
    });
    globalThis.fetch = fetchMock;

    await generateRecommendations(input);

    const userContent: string = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content;
    expect(userContent).toContain('opened by the agent during this run');
    expect(userContent).toContain('ORGS');
    expect(userContent).not.toContain('MFA xxx');
    expect(userContent).toContain('Not shown');
    expect(userContent).toContain('auth0/references/feature-mfa/index.md');
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
