/**
 * Tenant fixture evals through `--phase agent` and `--phase grade`.
 *
 * Uses a real fixture.ts, the real fixture lifecycle, artefact writer and grader executors. Only
 * the management client, the agent runner and the LLM calls are stubbed. The sentinel secret is
 * registered by the fixture, so it is a known secret that must never reach the stored artefact.
 */

import { TEST_CONFIG } from './setup-config.js';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTmpDir } from './tmp.js';
import type { AgentType, EvalConfig, JobResult, RunRecord } from '@a0/evals-core';

const hoisted = vi.hoisted(() => ({
  runner: {
    prepareSkills: async (evalDef: unknown) => evalDef,
    run: async (_p: unknown): Promise<unknown> => {
      throw new Error('runner not configured');
    },
  },
}));

vi.mock('../src/runners/claude-code/runner.js', () => ({
  ClaudeCodeRunner: class {
    prepareSkills = (e: unknown) => hoisted.runner.prepareSkills(e);
    run = (p: unknown) => hoisted.runner.run(p);
  },
}));
vi.mock('../src/runners/copilot/runner.js', () => ({ CopilotCliRunner: class {} }));
vi.mock('../src/runners/gemini-cli/runner.js', () => ({ GeminiCliRunner: class {} }));
vi.mock('../src/runners/codex/runner.js', () => ({ CodexRunner: class {} }));
vi.mock('@a0/evals-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@a0/evals-core')>()),
  createManagementClient: () => ({ domain: 'test.auth0.com' }),
}));

import { runJob, runAgentPhaseJob, gradeArtifact } from '../src/cli/run.js';
import { findRunArtifacts, readRunArtifact, setFrameworkConfig } from '@a0/evals-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRADERS_ABS_PATH = resolve(__dirname, '../../evals-graders/dist/index.js');

const EVAL_ID = 'fixture_eval';
const MODEL = 'claude-sonnet-5';
const AGENT_TYPE: AgentType = 'claude-code';
const SENTINEL = 'sentinel_value_0123456789abcdef';
const CLIENT_SECRET = 'verifier-client-secret-value';
const tmp = makeTmpDir('fixture_phase_');

const evalConfig: EvalConfig = {
  id: EVAL_ID,
  name: 'Fixture',
  category: 'cli',
  path: `src/evals/cli/${EVAL_ID}`,
};

const PROMPT = `---
id: ${EVAL_ID}
category: cli
---

## Task
Create the connection in the tenant.
`;

const GRADERS = `import { contains, tenantState, secretNotExposed, GraderLevel } from '${GRADERS_ABS_PATH}';
export function defineGraders() {
  return [
    contains('export', 'writes an export', GraderLevel.L1),
    tenantState('Tenant changed during the run', GraderLevel.L4, ({ pre, post, seeded }) =>
      (post.count > pre.count && seeded.seedMarker === 'seeded') || 'Tenant did not change'),
    secretNotExposed(),
  ];
}
`;

/** The snapshot holds the secret on purpose, to prove the stored state is masked. */
const FIXTURE = `let calls = 0;
export default {
  seed: async (ctx) => {
    ctx.registerSecret('${SENTINEL}');
    return { seedMarker: 'seeded' };
  },
  snapshot: async () => ({ count: ++calls, token: '${SENTINEL}' }),
};
`;

/** Prints its first argument, so the compile command line and its output both carry the secret. */
const ECHO_SCRIPT = 'console.log(process.argv[2]);\n';

function makeRoot(options: { compileEchoes?: string } = {}): string {
  const root = tmp();
  const dir = join(root, evalConfig.path);
  mkdirSync(join(dir, 'scaffold/src'), { recursive: true });
  const prompt =
    options.compileEchoes === undefined
      ? PROMPT
      : PROMPT.replace('category: cli\n', `category: cli\ncompile_command: node echo.js ${options.compileEchoes}\n`);
  writeFileSync(join(dir, 'PROMPT.md'), prompt);
  if (options.compileEchoes !== undefined) writeFileSync(join(dir, 'scaffold/echo.js'), ECHO_SCRIPT);
  writeFileSync(join(dir, 'scaffold/src/main.ts'), 'export {};\n');
  writeFileSync(join(dir, 'graders.ts'), GRADERS);
  writeFileSync(join(dir, 'fixture.ts'), FIXTURE);
  return root;
}

function toolCall(command: string, result: string): RunRecord['toolCalls'][number] {
  return {
    name: 'run_command',
    args: { command },
    result,
    startTime: 101,
    endTime: 102,
    isDocLookup: false,
    isInterruption: false,
    causedError: false,
    actionType: 'Implementation',
    isRetry: false,
    recoveredFromError: false,
  };
}

/** The agent either leaks the sentinel everywhere it can, or never mentions it. */
function installRunner(leak: boolean): void {
  hoisted.runner.run = async (params: unknown) => {
    const { workspace } = params as { workspace: string };
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'src/app.ts'), leak ? `export const key = '${SENTINEL}';\n` : 'export {};\n');
    const record: RunRecord = {
      taskName: EVAL_ID,
      model: MODEL,
      sessionId: 'fixed-session',
      startTime: 100,
      endTime: 160.5,
      toolCalls: leak
        ? [toolCall(`auth0 api get clients --token ${SENTINEL}`, `token is ${SENTINEL}`)]
        : [toolCall('auth0 api get clients', 'ok')],
      turnMetrics: [],
      providerErrors: [],
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
      status: 'success',
      finalSummary: leak ? `I used ${SENTINEL} to connect.` : 'Connected.',
      workspace,
    };
    return { record, resolvedModel: 'claude-sonnet-5-resolved' };
  };
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"recommendations": []}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
    })),
  );
}

async function agentPhase(root: string): Promise<{ artifactRoot: string; artifactDir: string }> {
  const artifactRoot = tmp();
  const ok = await runAgentPhaseJob(evalConfig, MODEL, 'agent', [], 'key', false, AGENT_TYPE, root, artifactRoot);
  expect(ok).toBe(true);
  const [artifactDir] = findRunArtifacts(artifactRoot);
  return { artifactRoot, artifactDir: artifactDir! };
}

function gradePhase(artifactDir: string, root: string): Promise<JobResult> {
  return gradeArtifact(readRunArtifact(artifactDir), new Map([[EVAL_ID, evalConfig]]), 'key', root);
}

function graderSummary(result: JobResult): Array<{ name: string; passed: boolean; detail: string }> {
  if (result.status === 'error' || !('graders' in result))
    throw new Error(`unexpected result: ${JSON.stringify(result)}`);
  return result.graders.map((g) => ({ name: g.name, passed: g.passed, detail: g.detail }));
}

/** The result without the per-call `resultSizeBytes`, which depends on whether a secret was masked first. */
function withoutSizes(result: JobResult): unknown {
  return JSON.parse(JSON.stringify(result, (key, value) => (key === 'resultSizeBytes' ? undefined : value)));
}

/** Every file under `dir`, recursively, as absolute paths. */
function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? allFiles(full) : [full];
  });
}

beforeAll(() => {
  // Read once by the module on first use, which then removes the keys from process.env.
  process.env.AUTH0_VERIFIER_DOMAIN = 'test.auth0.com';
  process.env.AUTH0_VERIFIER_CLIENT_ID = 'cid';
  process.env.AUTH0_VERIFIER_CLIENT_SECRET = CLIENT_SECRET;
});
beforeEach(() => {
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setFrameworkConfig(TEST_CONFIG);
});

describe('agent phase with a leaking agent', () => {
  beforeEach(() => installRunner(true));

  it('stores no occurrence of any known secret in run.json or the workspace snapshot', async () => {
    const { artifactDir } = await agentPhase(makeRoot());

    const files = allFiles(artifactDir);
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      expect(text, file).not.toContain(SENTINEL);
      expect(text, file).not.toContain(CLIENT_SECRET);
    }
    expect(readFileSync(join(artifactDir, 'workspace/src/app.ts'), 'utf-8')).toContain('[REDACTED SECRET]');
  });

  it('masks the secret out of the stored compile result', async () => {
    const { artifactDir } = await agentPhase(makeRoot({ compileEchoes: SENTINEL }));

    const stored = readRunArtifact(artifactDir);
    if (stored.kind !== 'agent') throw new Error('expected an agent artefact');
    expect(stored.run.compileResult?.command).toBe('node echo.js [REDACTED SECRET]');
    expect(stored.run.compileResult?.output).toBe('[REDACTED SECRET]\n');
    for (const file of allFiles(artifactDir)) expect(readFileSync(file, 'utf-8'), file).not.toContain(SENTINEL);
  });

  it('reports where the secret appeared without holding its value', async () => {
    const { artifactDir } = await agentPhase(makeRoot());

    const stored = readRunArtifact(artifactDir);
    if (stored.kind !== 'agent') throw new Error('expected an agent artefact');
    expect(stored.run.fixture?.exposure).toEqual({
      checked: 2,
      locations: ['tool call 1 arguments', 'tool call 1 output', 'final reply', 'file src/app.ts'],
    });
    expect(JSON.stringify(stored.run.fixture)).not.toContain(SENTINEL);
    expect(stored.run.fixture?.state).toMatchObject({ seeded: { seedMarker: 'seeded' } });
  });

  it('grades from the stored state and exposure with the real executors', async () => {
    const root = makeRoot();
    const { artifactDir } = await agentPhase(root);

    const graders = graderSummary(await gradePhase(artifactDir, root));

    expect(graders.map((g) => [g.name, g.passed])).toEqual([
      ['writes an export', true],
      ['Tenant changed during the run', true],
      ['No credential exposed in trace, reply, or files', false],
    ]);
    expect(graders[2]!.detail).toContain('Secret exposed in tool call 1 arguments');
    expect(JSON.stringify(graders)).not.toContain(SENTINEL);
  });
});

describe('agent phase with a well behaved agent', () => {
  beforeEach(() => installRunner(false));

  it('passes the state and exposure graders from the stored data', async () => {
    const root = makeRoot();
    const { artifactDir } = await agentPhase(root);

    const stored = readRunArtifact(artifactDir);
    if (stored.kind !== 'agent') throw new Error('expected an agent artefact');
    // The stored snapshot has the known secret masked, so the predicate on `token` sees the marker.
    expect(stored.run.fixture?.state).toMatchObject({ post: { token: '[REDACTED SECRET]' } });
    expect(stored.run.fixture?.exposure).toEqual({ checked: 2, locations: [] });

    const graders = graderSummary(await gradePhase(artifactDir, root));
    expect(graders.find((g) => g.name.startsWith('No credential'))).toMatchObject({
      passed: true,
      detail: 'No secret found (2 checked)',
    });
  });

  it('grades with the empty secret list of the grade job without crashing', async () => {
    const root = makeRoot();
    const { artifactDir } = await agentPhase(root);

    const result = await gradePhase(artifactDir, root);

    expect(result.status).not.toBe('error');
    expect(graderSummary(result)).toHaveLength(3);
  });

  it('fails the fixture graders with their usual messages when the artefact has no fixture block', async () => {
    const root = makeRoot();
    const { artifactDir } = await agentPhase(root);
    const runPath = join(artifactDir, 'run.json');
    const run = JSON.parse(readFileSync(runPath, 'utf-8')) as Record<string, unknown>;
    delete run.fixture;
    writeFileSync(runPath, JSON.stringify(run));

    const result = await gradePhase(artifactDir, root);

    expect(result.status).not.toBe('error');
    const byName = Object.fromEntries(graderSummary(result).map((g) => [g.name, g]));
    expect(byName['Tenant changed during the run']).toMatchObject({
      passed: false,
      detail: expect.stringContaining('No tenant state available'),
    });
    expect(byName['No credential exposed in trace, reply, or files']).toMatchObject({
      passed: false,
      detail: expect.stringContaining('No secrets known'),
    });
  });
});

describe('--phase all vs --phase agent + --phase grade for a fixture eval', () => {
  it.each([[true], [false]])('yields the same grader results (agent leaks the secret: %s)', async (leak) => {
    installRunner(leak);
    const root = makeRoot();

    const all = await runJob(evalConfig, MODEL, 'agent', [], 'key', false, AGENT_TYPE, root, false);
    const { artifactDir } = await agentPhase(root);
    const split = await gradePhase(artifactDir, root);

    expect(all.status).not.toBe('error');
    expect(split.status).not.toBe('error');
    expect(graderSummary(split)).toEqual(graderSummary(all));
    // The trace byte sizes are measured before masking on the combined path and after it on the
    // split path, so they differ for a leaked secret. Everything else must be identical.
    expect(withoutSizes(split)).toEqual(withoutSizes(all));
    const secretGrader = graderSummary(split).find((g) => g.name.startsWith('No credential'));
    expect(secretGrader?.passed).toBe(!leak);
  });

  it('loads the fixture in the agent phase even though graders.ts is gone', async () => {
    installRunner(false);
    const root = makeRoot();
    rmSync(join(root, evalConfig.path, 'graders.ts'));

    const { artifactDir } = await agentPhase(root);

    const stored = readRunArtifact(artifactDir);
    if (stored.kind !== 'agent') throw new Error('expected an agent artefact');
    expect(stored.run.fixture?.state).toBeDefined();
    expect(stored.run.fixture?.exposure.checked).toBe(2);
  });
});
