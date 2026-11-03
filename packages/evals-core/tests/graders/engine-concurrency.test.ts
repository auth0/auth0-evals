/**
 * Tests for judge.concurrency in runGraders: results keep definition order, the cap
 * is respected, and the default stays sequential.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from '../tmp.js';
import { judge, contains } from '@a0/evals-graders';
import { setFrameworkConfig } from '../../src/config/framework-config.js';
import type { FrameworkConfig } from '../../src/config/framework.js';
import { runGraders } from '../../src/graders/engine.js';

function config(concurrency?: number): Required<FrameworkConfig> {
  return {
    evalsDir: 'src/evals',
    proxy: { baseUrl: 'https://llm.example.com/v1' },
    mcp: { servers: {} },
    skills: { remoteRepos: [], localDirs: [] },
    judge: { model: 'judge-model', maxTokens: 1024, maxCodeChars: 16_384, concurrency },
    models: { known: [], default: '', modelIds: {} },
  } as Required<FrameworkConfig>;
}

const tmpDir = makeTmpDir('graders_concurrency_');

/**
 * Stubs fetch so each judge question `Q<n>` answers after `delays[n]` ms with the verdict
 * in `verdicts[n]`, a `FAIL` question returns HTTP 400, and the peak number of requests
 * in flight at once is recorded.
 */
function stubJudgeFetch(delays: number[], verdicts: string[]): { peak: () => number } {
  let inFlight = 0;
  let peak = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { messages: Array<{ role: string; content: string }> };
      const user = body.messages.find((m) => m.role === 'user')!.content;
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        if (user.includes('FAIL')) {
          return { ok: false, status: 400, text: async () => 'bad request' };
        }
        const n = Number(/Q(\d+)/.exec(user)![1]);
        await new Promise((r) => setTimeout(r, delays[n]));
        return { ok: true, json: async () => ({ choices: [{ message: { content: `reason\n\n${verdicts[n]}` } }] }) };
      } finally {
        inFlight--;
      }
    }),
  );
  return { peak: () => peak };
}

function workspace(): string {
  const dir = tmpDir();
  writeFileSync(join(dir, 'app.js'), 'const x = 1;');
  return dir;
}

describe('runGraders - judge concurrency', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs one grader at a time when concurrency is unset', async () => {
    setFrameworkConfig(config(undefined));
    const fetch = stubJudgeFetch([5, 5, 5], ['yes', 'yes', 'yes']);
    const results = await runGraders(
      [judge('Is Q0 correct?'), judge('Is Q1 correct?'), judge('Is Q2 correct?')],
      workspace(),
      'key',
    );
    expect(results.map((r) => r.passed)).toEqual([true, true, true]);
    expect(fetch.peak()).toBe(1);
  });

  it('keeps definition order when later judges finish first', async () => {
    setFrameworkConfig(config(4));
    // Q0 is slowest, Q3 fastest, so completion order is the reverse of definition order.
    const fetch = stubJudgeFetch([40, 30, 20, 10], ['yes', 'no', 'yes', 'no']);
    const graders = [
      judge('Is Q0 correct?'),
      judge('Is Q1 correct?'),
      contains('const x'),
      judge('Is Q2 correct?'),
      judge('Is Q3 correct?'),
    ];
    const results = await runGraders(graders, workspace(), 'key');
    expect(results.map((r) => r.name)).toEqual(graders.map((g) => g.name));
    expect(results.map((r) => r.passed)).toEqual([true, false, true, true, false]);
    expect(fetch.peak()).toBe(4);
  });

  it('never runs more judges at once than the configured cap', async () => {
    setFrameworkConfig(config(2));
    const fetch = stubJudgeFetch([10, 10, 10, 10, 10], ['yes', 'yes', 'yes', 'yes', 'yes']);
    const graders = [0, 1, 2, 3, 4].map((n) => judge(`Is Q${n} correct?`));
    const results = await runGraders(graders, workspace(), 'key');
    expect(results).toHaveLength(5);
    expect(fetch.peak()).toBe(2);
  });

  it('records a failing judge as its own error without affecting the others', async () => {
    setFrameworkConfig(config(3));
    stubJudgeFetch([5, 0, 5], ['yes', '', 'yes']);
    const results = await runGraders(
      [judge('Is Q0 correct?'), judge('Is FAIL correct?'), judge('Is Q2 correct?')],
      workspace(),
      'key',
    );
    expect(results.map((r) => r.passed)).toEqual([true, false, true]);
    expect(results[1]!.detail).toMatch(/^Grader error/);
  });

  it.each([0, -1, 1.5, Number.NaN])('treats an invalid concurrency (%s) as sequential', async (value) => {
    setFrameworkConfig(config(value));
    const fetch = stubJudgeFetch([5, 5], ['yes', 'yes']);
    await runGraders([judge('Is Q0 correct?'), judge('Is Q1 correct?')], workspace(), 'key');
    expect(fetch.peak()).toBe(1);
  });
});
