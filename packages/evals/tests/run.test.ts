/**
 * Unit tests for buildJobList and buildSubprocessArgs in cli/run.ts.
 *
 * buildJobList is pure routing logic — it maps (registry, models, modes, tools, agentType)
 * to a flat list of jobs. No subprocess, no filesystem, no mocking required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildJobList, buildSubprocessArgs } from '../src/cli/run.js';
import type { EvalConfig } from '@a0/evals-core';
import { makeTmpDir } from './tmp.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvalCfg(id = 'test_eval'): EvalConfig {
  return { id, category: 'quickstarts', path: `/tmp/${id}` } as EvalConfig;
}

const EVAL = makeEvalCfg('test_eval');

// ── baseline mode ─────────────────────────────────────────────────────────────

describe('buildJobList — baseline mode', () => {
  it('creates one job per model', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2', 'claude-sonnet-4-6'], ['baseline'], [], undefined);
    expect(jobs).toHaveLength(2);
    expect(jobs[0][1]).toBe('gpt-5.2');
    expect(jobs[1][1]).toBe('claude-sonnet-4-6');
  });

  it('baseline jobs always have empty tools', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline'], ['skills'], undefined);
    expect(jobs[0][3]).toEqual([]);
  });

  it('baseline jobs use DEFAULT_AGENT_TYPE as agentType placeholder', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline'], [], undefined);
    expect(jobs[0][4]).toBe('copilot');
  });

  it('baseline jobs use the explicitly provided agentType', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline'], [], 'claude-code');
    expect(jobs[0][4]).toBe('claude-code');
  });
});

// ── agent mode — auto-routing ─────────────────────────────────────────────────

describe('buildJobList — agent mode auto-routing', () => {
  it('claude- model with no explicit agent type → routes to claude-code', () => {
    const jobs = buildJobList([EVAL], ['claude-sonnet-4-6'], ['agent'], [], undefined);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('claude-code');
    expect(jobs[0][1]).toBe('claude-sonnet-4-6');
  });

  it('gpt- model with no explicit agent type → routes to codex', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], [], undefined);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('codex');
    expect(jobs[0][1]).toBe('gpt-5.2');
  });

  it('non-claude non-gemini non-gpt model with no explicit agent type → routes to DEFAULT_AGENT_TYPE', () => {
    const jobs = buildJobList([EVAL], ['some-other-model'], ['agent'], [], undefined);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][4]).toBe('copilot');
    expect(jobs[0][1]).toBe('some-other-model');
  });

  it('explicit --agent-type claude-code with non-claude model → sentinel job', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], [], 'claude-code');
    expect(jobs).toHaveLength(1);
    expect(jobs[0][1]).toBe('claude-code'); // model sentinel, not gpt-5.2
    expect(jobs[0][4]).toBe('claude-code');
  });

  it('explicit --agent-type claude-code with non-claude model deduplicates across models', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2', 'gpt-4'], ['agent'], [], 'claude-code');
    // Both models would produce the same claude-code sentinel job — only one should be emitted
    expect(jobs).toHaveLength(1);
    expect(jobs[0][1]).toBe('claude-code');
  });

  it('explicit --agent-type claude-code with non-claude model does not deduplicate across evals', () => {
    const eval2 = makeEvalCfg('another_eval');
    const jobs = buildJobList([EVAL, eval2], ['gpt-5.2'], ['agent'], [], 'claude-code');
    expect(jobs).toHaveLength(2);
    expect(jobs[0][0].id).toBe('test_eval');
    expect(jobs[1][0].id).toBe('another_eval');
  });
});

// ── tools propagation ─────────────────────────────────────────────────────────

describe('buildJobList — tools propagation', () => {
  it('agent jobs receive the tools array', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['agent'], ['skills', 'mcp'], undefined);
    expect(jobs[0][3]).toEqual(['skills', 'mcp']);
  });

  it('baseline jobs do not receive tools even when tools are passed', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline'], ['skills'], undefined);
    expect(jobs[0][3]).toEqual([]);
  });
});

// ── mixed modes ───────────────────────────────────────────────────────────────

describe('buildJobList — mixed modes', () => {
  it('both baseline and agent → two jobs per model', () => {
    const jobs = buildJobList([EVAL], ['gpt-5.2'], ['baseline', 'agent'], [], undefined);
    expect(jobs).toHaveLength(2);
    const modes = jobs.map((j) => j[2]);
    expect(modes).toContain('baseline');
    expect(modes).toContain('agent');
  });

  it('multiple evals × multiple models × both modes → correct job count', () => {
    const eval2 = makeEvalCfg('eval_2');
    const jobs = buildJobList([EVAL, eval2], ['gpt-5.2', 'gpt-4o'], ['baseline', 'agent'], [], undefined);
    // 2 evals × 2 models × 2 modes = 8 jobs
    expect(jobs).toHaveLength(8);
  });
});

// ── buildSubprocessArgs ───────────────────────────────────────────────────────

describe('buildSubprocessArgs', () => {
  it('strips --eval and its value', () => {
    expect(buildSubprocessArgs(['--eval', 'react_quickstart', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --output and its value', () => {
    expect(buildSubprocessArgs(['--output', 'scores.json', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --model and its value', () => {
    expect(buildSubprocessArgs(['--model', 'gpt-5.4', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --mode and its value', () => {
    expect(buildSubprocessArgs(['--mode', 'agent', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --tools and its value', () => {
    expect(buildSubprocessArgs(['--tools', 'skills,mcp', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips --agent-type and its value', () => {
    expect(buildSubprocessArgs(['--agent-type', 'claude-code', '--workers', '4'])).toEqual(['--workers', '4']);
  });

  it('strips multiple per-job flags and keeps the rest', () => {
    const argv = [
      '--eval',
      'react_quickstart',
      '--model',
      'gpt-5.4',
      '--mode',
      'agent',
      '--tools',
      'skills',
      '--agent-type',
      'copilot',
      '--output',
      'scores.json',
      '--workers',
      '8',
      '--keep-workspace',
    ];
    expect(buildSubprocessArgs(argv)).toEqual(['--workers', '8', '--keep-workspace']);
  });

  it('returns empty array when all args are stripped', () => {
    expect(buildSubprocessArgs(['--eval', 'foo', '--model', 'gpt-5.4', '--mode', 'baseline'])).toEqual([]);
  });

  it('returns input unchanged when no per-job flags are present', () => {
    expect(buildSubprocessArgs(['--workers', '4', '--braintrust'])).toEqual(['--workers', '4', '--braintrust']);
  });
});

// ── jobSubprocessEnv ──────────────────────────────────────────────────────────

describe('jobSubprocessEnv', () => {
  const VERIFIER_KEYS = ['AUTH0_VERIFIER_DOMAIN', 'AUTH0_VERIFIER_CLIENT_ID', 'AUTH0_VERIFIER_CLIENT_SECRET'] as const;
  const tmp = makeTmpDir('job_env_');
  let savedEnv: NodeJS.ProcessEnv;
  const createdTempDirs: string[] = [];

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    for (const dir of createdTempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    process.env = savedEnv;
    vi.resetModules();
  });

  function setCredentials(): void {
    process.env.AUTH0_VERIFIER_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_VERIFIER_CLIENT_ID = 'cid';
    process.env.AUTH0_VERIFIER_CLIENT_SECRET = 'dummy-secret-value';
  }

  function clearCredentials(): void {
    for (const key of [...VERIFIER_KEYS, 'AUTH0_VERIFIER_CREDENTIALS_FILE']) delete process.env[key];
  }

  /** Creates <root>/<path>/PROMPT.md, plus fixture.ts when `withFixture` is set. */
  function makeEval(withFixture: boolean): { evalCfg: EvalConfig; frameworkRoot: string } {
    const frameworkRoot = tmp();
    const path = 'src/evals/cli/sample_eval';
    const dir = join(frameworkRoot, path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'PROMPT.md'), '---\nid: sample_eval\n---\nPrompt\n');
    if (withFixture) writeFileSync(join(dir, 'fixture.ts'), 'export default {};\n');
    return { evalCfg: { id: 'sample_eval', category: 'cli', path } as EvalConfig, frameworkRoot };
  }

  async function freshModule() {
    vi.resetModules();
    return import('../src/cli/run.js');
  }

  it('gives an agent job with a fixture a single-use credentials file', async () => {
    clearCredentials();
    setCredentials();
    const { jobSubprocessEnv } = await freshModule();
    const { evalCfg, frameworkRoot } = makeEval(true);

    const { env, tempDir } = jobSubprocessEnv(evalCfg, 'agent', frameworkRoot);
    if (tempDir) createdTempDirs.push(tempDir);

    const file = env?.AUTH0_VERIFIER_CREDENTIALS_FILE;
    expect(file).toBeTruthy();
    expect(tempDir).toBe(dirname(file as string));
    expect(existsSync(file as string)).toBe(true);
    expect(JSON.parse(readFileSync(file as string, 'utf8'))).toEqual({
      domain: 'test.auth0.com',
      client_id: 'cid',
      client_secret: 'dummy-secret-value',
    });
    if (process.platform !== 'win32') expect(statSync(file as string).mode & 0o777).toBe(0o600);
  });

  it('returns nothing for an agent job whose eval has no fixture', async () => {
    clearCredentials();
    setCredentials();
    const { jobSubprocessEnv } = await freshModule();
    const { evalCfg, frameworkRoot } = makeEval(false);

    expect(jobSubprocessEnv(evalCfg, 'agent', frameworkRoot)).toEqual({});
  });

  it('returns nothing for a baseline job even when the eval has a fixture', async () => {
    clearCredentials();
    setCredentials();
    const { jobSubprocessEnv } = await freshModule();
    const { evalCfg, frameworkRoot } = makeEval(true);

    expect(jobSubprocessEnv(evalCfg, 'baseline', frameworkRoot)).toEqual({});
  });

  it('never exposes the verifier env vars to the child or to process.env', async () => {
    clearCredentials();
    setCredentials();
    const { jobSubprocessEnv } = await freshModule();
    const { evalCfg, frameworkRoot } = makeEval(true);

    const { env, tempDir } = jobSubprocessEnv(evalCfg, 'agent', frameworkRoot);
    if (tempDir) createdTempDirs.push(tempDir);

    expect(env).toBeDefined();
    for (const key of VERIFIER_KEYS) {
      expect(env).not.toHaveProperty(key);
      expect(process.env).not.toHaveProperty(key);
    }
  });

  it('returns nothing when no credentials are configured', async () => {
    clearCredentials();
    const { jobSubprocessEnv } = await freshModule();
    const { evalCfg, frameworkRoot } = makeEval(true);

    expect(jobSubprocessEnv(evalCfg, 'agent', frameworkRoot)).toEqual({});
  });
});
