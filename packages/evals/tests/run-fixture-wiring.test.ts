/**
 * Unit tests for the tenant-fixture wiring in runAgentJob (reached through runJob).
 *
 * The core framework functions are mocked so the tests exercise only the ordering,
 * guard, and cleanup logic around the fixture session.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EvalConfig } from '@a0/evals-core';
import { makeTmpDir } from './tmp.js';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  evalDef: {} as Record<string, unknown>,
  loadEval: vi.fn(),
  setupWorkspace: vi.fn(),
  writeAgentGuidance: vi.fn(),
  runSetupCommand: vi.fn(),
  runCompileCommand: vi.fn(),
  cleanupWorkspace: vi.fn(),
  openFixture: vi.fn(),
  createManagementClient: vi.fn(),
  registerRunner: vi.fn(),
  getRunner: vi.fn(),
  getFrameworkConfig: vi.fn(),
  runGraders: vi.fn(),
  serialiseAgent: vi.fn(),
  close: vi.fn(),
  capturePost: vi.fn(),
  runnerRun: vi.fn(),
}));

vi.mock('@a0/evals-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@a0/evals-core')>()),
  loadEval: mocks.loadEval,
  setupWorkspace: mocks.setupWorkspace,
  writeAgentGuidance: mocks.writeAgentGuidance,
  runSetupCommand: mocks.runSetupCommand,
  runCompileCommand: mocks.runCompileCommand,
  cleanupWorkspace: mocks.cleanupWorkspace,
  openFixture: mocks.openFixture,
  createManagementClient: mocks.createManagementClient,
  registerRunner: mocks.registerRunner,
  getRunner: mocks.getRunner,
  getFrameworkConfig: mocks.getFrameworkConfig,
  runGraders: mocks.runGraders,
  serialiseAgent: mocks.serialiseAgent,
}));

vi.mock('../src/recommendations/index.js', () => ({
  generateRunRecommendations: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/scorer.js', () => ({
  score: vi.fn().mockReturnValue({}),
}));

const WORKSPACE = '/tmp/fake-workspace';
const VERIFIER_KEYS = [
  'AUTH0_VERIFIER_DOMAIN',
  'AUTH0_VERIFIER_CLIENT_ID',
  'AUTH0_VERIFIER_CLIENT_SECRET',
  'AUTH0_VERIFIER_CREDENTIALS_FILE',
] as const;

const EVAL_CFG = { id: 'sample_eval', category: 'cli', path: 'src/evals/cli/sample_eval' } as EvalConfig;

async function freshRunJob() {
  vi.resetModules();
  const { runJob } = await import('../src/cli/run.js');
  return (sandbox = false) =>
    runJob(EVAL_CFG, 'claude-sonnet-5', 'agent', [], 'key', false, 'claude-code', '/tmp/root', sandbox);
}

function errorOf(result: unknown): string {
  return String((result as { error?: unknown }).error ?? '');
}

describe('runAgentJob tenant fixture wiring', () => {
  const tmp = makeTmpDir('fixture_phase_');
  let savedEnv: NodeJS.ProcessEnv;

  function setCredentials(): void {
    process.env.AUTH0_VERIFIER_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_VERIFIER_CLIENT_ID = 'cid';
    process.env.AUTH0_VERIFIER_CLIENT_SECRET = 'dummy-secret-value';
  }

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const key of VERIFIER_KEYS) delete process.env[key];

    vi.clearAllMocks();
    mocks.order.length = 0;
    for (const key of Object.keys(mocks.evalDef)) delete mocks.evalDef[key];
    Object.assign(mocks.evalDef, { id: 'sample_eval', category: 'cli', graders: [], fixture: {} });

    mocks.loadEval.mockImplementation(async () => mocks.evalDef);
    mocks.setupWorkspace.mockReturnValue(WORKSPACE);
    mocks.cleanupWorkspace.mockImplementation(() => {
      mocks.order.push('cleanupWorkspace');
    });
    mocks.close.mockImplementation(async () => {
      mocks.order.push('close');
    });
    mocks.capturePost.mockResolvedValue(undefined);
    mocks.openFixture.mockImplementation(async () => ({
      close: mocks.close,
      capturePost: mocks.capturePost,
      gradingInput: () => ({ state: undefined, secrets: [] }),
      pre: undefined,
      secrets: [],
      context: { runId: 'rid', seeded: {} },
    }));
    mocks.createManagementClient.mockReturnValue({});
    mocks.runnerRun.mockResolvedValue({
      record: { toolCalls: [], finalSummary: '' },
      resolvedModel: 'claude-sonnet-5',
    });
    mocks.getRunner.mockReturnValue({ prepareSkills: vi.fn(), run: mocks.runnerRun });
    mocks.getFrameworkConfig.mockReturnValue({
      cliContext: undefined,
      sandbox: { passthroughEnv: [] },
      scoring: {},
    });
    mocks.runGraders.mockResolvedValue([]);
    mocks.serialiseAgent.mockReturnValue({ status: 'success' });
  });

  afterEach(() => {
    process.env = savedEnv;
    vi.resetModules();
  });

  it('closes the fixture session when the agent run rejects', async () => {
    setCredentials();
    mocks.runnerRun.mockRejectedValue(new Error('agent exploded'));
    const run = await freshRunJob();

    const result = await run();

    expect(result.status).toBe('error');
    expect(mocks.openFixture).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('closes the fixture session when the post-run snapshot rejects', async () => {
    setCredentials();
    mocks.capturePost.mockRejectedValue(new Error('snapshot failed'));
    const run = await freshRunJob();

    const result = await run();

    expect(result.status).toBe('error');
    expect(mocks.capturePost).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('takes the post-run snapshot before the compile command runs', async () => {
    setCredentials();
    mocks.evalDef.compileCommand = 'npm run build';
    mocks.capturePost.mockImplementation(async () => {
      mocks.order.push('snapshot');
    });
    mocks.runCompileCommand.mockImplementation(() => {
      mocks.order.push('compile');
      return undefined;
    });
    const run = await freshRunJob();

    await run();

    expect(mocks.order.indexOf('snapshot')).toBeGreaterThanOrEqual(0);
    expect(mocks.order.indexOf('snapshot')).toBeLessThan(mocks.order.indexOf('compile'));
  });

  it('closes the fixture session when the compile command throws', async () => {
    setCredentials();
    mocks.evalDef.compileCommand = 'npm run build';
    mocks.runCompileCommand.mockImplementation(() => {
      throw new Error('compile blew up');
    });
    const run = await freshRunJob();

    const result = await run();

    expect(result.status).toBe('error');
    expect(mocks.runCompileCommand).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('refuses a fixture eval in the sandbox without opening the fixture', async () => {
    setCredentials();
    const run = await freshRunJob();

    const result = await run(true);

    expect(result.status).toBe('error');
    expect(errorOf(result)).toContain('dangerously-skip-sandbox');
    expect(mocks.openFixture).not.toHaveBeenCalled();
  });

  it('refuses a fixture eval without a verifier credential and does not open the fixture', async () => {
    const run = await freshRunJob();

    const result = await run(false);

    expect(result.status).toBe('error');
    expect(errorOf(result)).toContain('verifier credential');
    expect(mocks.openFixture).not.toHaveBeenCalled();
  });

  it('closes the fixture session before the workspace is removed', async () => {
    setCredentials();
    const run = await freshRunJob();

    await run();

    expect(mocks.cleanupWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupWorkspace).toHaveBeenCalledWith(WORKSPACE);
    expect(mocks.order).toEqual(['close', 'cleanupWorkspace']);
  });

  it('opens, snapshots, and closes the fixture once on the success path', async () => {
    setCredentials();
    const run = await freshRunJob();

    const result = await run();

    expect(result.status).not.toBe('error');
    expect(mocks.openFixture).toHaveBeenCalledTimes(1);
    expect(mocks.capturePost).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('passes the verifier client secret to openFixture as an extra secret', async () => {
    setCredentials();
    const run = await freshRunJob();

    await run();

    expect(mocks.openFixture).toHaveBeenCalledWith(
      mocks.evalDef.fixture,
      expect.objectContaining({ extraSecrets: ['dummy-secret-value'] }),
    );
  });

  it('refuses a fixture eval in the agent phase before creating a workspace', async () => {
    setCredentials();
    vi.resetModules();
    const { runAgentPhaseJob } = await import('../src/cli/run.js');

    const ok = await runAgentPhaseJob(
      EVAL_CFG,
      'claude-sonnet-5',
      'agent',
      [],
      'key',
      false,
      'claude-code',
      '/tmp/root',
      tmp(),
    );

    expect(ok).toBe(false);
    expect(mocks.setupWorkspace).not.toHaveBeenCalled();
    expect(mocks.openFixture).not.toHaveBeenCalled();
  });
});
