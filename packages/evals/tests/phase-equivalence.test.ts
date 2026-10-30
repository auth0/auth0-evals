/**
 * Equivalence of `--phase all` and `--phase agent` -> artefact -> `--phase grade`.
 *
 * A deterministic stub runner produces the same recorded run on both paths; judges and the
 * recommendations analyst go through a stubbed `fetch` that records every request body.
 * The two JobResults must be deep-equal (no field is excluded) and the LLM request bodies
 * must be byte-identical.
 */

import { TEST_CONFIG } from './setup-config.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  baseline: vi.fn(),
}));

// initRunners() registers the real runners at first use, so stub the classes themselves.
vi.mock('../src/runners/claude-code/runner.js', () => ({
  ClaudeCodeRunner: class {
    prepareSkills = (e: unknown) => hoisted.runner.prepareSkills(e);
    run = (p: unknown) => hoisted.runner.run(p);
  },
}));
vi.mock('../src/runners/copilot/runner.js', () => ({ CopilotCliRunner: class {} }));
vi.mock('../src/runners/gemini-cli/runner.js', () => ({ GeminiCliRunner: class {} }));
vi.mock('../src/runners/codex/runner.js', () => ({ CodexRunner: class {} }));
vi.mock('../src/runners/baseline.js', () => ({ runBaseline: (...a: unknown[]) => hoisted.baseline(...a) }));

import { runJob, runAgentPhaseJob, gradeArtifact } from '../src/cli/run.js';
import { findRunArtifacts, readRunArtifact, resetSkillsManager, setFrameworkConfig } from '@a0/evals-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRADERS_ABS_PATH = resolve(__dirname, '../../evals-graders/dist/index.js');

const EVAL_ID = 'equiv_eval';
const MODEL = 'claude-sonnet-5';
const AGENT_TYPE: AgentType = 'claude-code';
const tmp = makeTmpDir('phase_equiv_');

/** The eval's skill, and a marker that only appears in its SKILL.md. */
const SKILL = 'auth0';
const SKILL_MARKER = 'SKILL-MARKER-7f3a: wrap the root in Auth0Provider';
/** Local skills dir the SkillsManager resolves from; removed before grading in the split path. */
let skillsRoot = '';

/** Creates `<root>/auth0/` with SKILL.md and a reference, and points the SkillsManager at it. */
function installSkills(): void {
  skillsRoot = tmp();
  mkdirSync(join(skillsRoot, SKILL, 'references'), { recursive: true });
  writeFileSync(join(skillsRoot, SKILL, 'SKILL.md'), `# Auth0\n\n${SKILL_MARKER}\n`);
  writeFileSync(join(skillsRoot, SKILL, 'references', 'react.md'), '# React\n\nUse @auth0/auth0-react.\n');
  setFrameworkConfig({ ...TEST_CONFIG, skills: { localDirs: [skillsRoot], remoteRepos: [] } });
  resetSkillsManager();
}

const evalConfig: EvalConfig = {
  id: EVAL_ID,
  name: 'Equivalence',
  category: 'quickstarts',
  path: `src/evals/quickstarts/${EVAL_ID}`,
};

const PROMPT = `---
id: ${EVAL_ID}
category: quickstarts
skills: ${SKILL}
---

## Task
Add Auth0 login to the app.
`;

const GRADERS = `import { contains, notContains, ranCommand, judge, GraderLevel } from '${GRADERS_ABS_PATH}';
export function defineGraders() {
  return [
    contains('Auth0Provider', { level: GraderLevel.L1 }),
    notContains('passport-auth0', { level: GraderLevel.L2 }),
    ranCommand('npm', ['install', '@auth0/auth0-react'], 'installed the SDK', GraderLevel.L4),
    judge('Is the Auth0 provider wired around the app root?', GraderLevel.L4),
    judge('Is the overall integration correct?'),
  ];
}
`;

/** Creates a framework root holding the eval; `withGraders: false` omits graders.ts entirely. */
function makeRoot(withGraders: boolean): string {
  const root = tmp();
  const dir = join(root, evalConfig.path);
  mkdirSync(join(dir, 'scaffold/src'), { recursive: true });
  writeFileSync(join(dir, 'PROMPT.md'), PROMPT);
  writeFileSync(join(dir, 'scaffold/src/main.tsx'), 'console.log("scaffold");\n');
  if (withGraders) writeFileSync(join(dir, 'graders.ts'), GRADERS);
  return root;
}

/** Deterministic run: same files and same record every time (only the workspace path varies). */
function installRunner(): void {
  hoisted.runner.run = async (params: unknown) => {
    const { workspace } = params as { workspace: string };
    mkdirSync(join(workspace, 'src'), { recursive: true });
    mkdirSync(join(workspace, 'node_modules/dep'), { recursive: true });
    writeFileSync(join(workspace, 'src/App.tsx'), '<Auth0Provider domain="x">\n  <App />\n</Auth0Provider>\n');
    writeFileSync(join(workspace, '.env'), 'VITE_AUTH0_DOMAIN=tenant.auth0.com\nSECRET=sk_live_abcdef0123456789\n');
    writeFileSync(join(workspace, 'node_modules/dep/index.js'), 'module.exports = 1;');
    writeFileSync(join(workspace, 'logo.bin'), Buffer.from([0xff, 0x00, 0xfe, 0x80]));
    const record: RunRecord = {
      taskName: EVAL_ID,
      model: MODEL,
      sessionId: 'fixed-session',
      startTime: 100,
      endTime: 160.5,
      toolCalls: [
        {
          name: 'run_command',
          args: { command: 'npm install @auth0/auth0-react' },
          result: 'added 1 package',
          startTime: 101,
          endTime: 110.25,
          isDocLookup: false,
          isInterruption: false,
          causedError: false,
          actionType: 'Implementation',
          isRetry: false,
          recoveredFromError: false,
        },
        {
          name: 'write_file',
          args: { path: 'src/App.tsx', content: '<Auth0Provider/>' },
          result: 'ok',
          startTime: 111,
          endTime: 112,
          isDocLookup: false,
          isInterruption: false,
          causedError: false,
          actionType: 'Implementation',
          isRetry: false,
          recoveredFromError: false,
        },
      ],
      turnMetrics: [
        {
          turn: 1,
          inputTokens: 1000,
          outputTokens: 200,
          llmLatency: 2.5,
          finishReason: 'tool_calls',
          toolCallCount: 2,
          costUsd: 0.01,
        },
      ],
      providerErrors: [],
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.01,
      status: 'success',
      finalSummary: 'Added Auth0Provider around the app.',
      workspace,
    };
    return { record, resolvedModel: 'claude-sonnet-5-resolved' };
  };
}

interface LlmRequest {
  url: string;
  body: string;
}
let requests: LlmRequest[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
      const body = opts.body as string;
      requests.push({ url, body });
      const user = (JSON.parse(body) as { messages: Array<{ role: string; content: string }> }).messages.find(
        (m) => m.role === 'user',
      )!.content;
      const content = user.includes('Diagnose this run') ? '{"recommendations": []}' : 'The code looks right.\n\nyes';
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 7 },
        }),
      };
    }),
  );
}

async function runAllPath(root: string, tools: string[]): Promise<{ result: JobResult; requests: LlmRequest[] }> {
  requests = [];
  const result = await runJob(evalConfig, MODEL, 'agent', tools, 'key', false, AGENT_TYPE, root, false);
  return { result, requests: [...requests] };
}

async function runSplitPath(
  agentRoot: string,
  gradeRoot: string,
  tools: string[],
): Promise<{ result: JobResult; artifactDir: string; requests: LlmRequest[] }> {
  const artifactRoot = tmp();
  requests = [];
  const ok = await runAgentPhaseJob(
    evalConfig,
    MODEL,
    'agent',
    tools,
    'key',
    false,
    AGENT_TYPE,
    agentRoot,
    artifactRoot,
  );
  expect(ok).toBe(true);
  // The agent phase never talks to the judge / analyst.
  expect(requests).toEqual([]);
  // Grading must not depend on the skills directory: it reuses the skill files stored in
  // the artefact. Removing the directory makes a fallback to the SkillsManager visible.
  rmSync(skillsRoot, { recursive: true, force: true });
  const [artifactDir] = findRunArtifacts(artifactRoot);
  const result = await gradeArtifact(readRunArtifact(artifactDir!), new Map([[EVAL_ID, evalConfig]]), 'key', gradeRoot);
  return { result, artifactDir: artifactDir!, requests: [...requests] };
}

beforeEach(() => {
  installRunner();
  stubFetch();
  installSkills();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setFrameworkConfig(TEST_CONFIG);
  resetSkillsManager();
});

/** Body of the recommendations analyst request (the only one asking to diagnose the run). */
function analystBody(reqs: LlmRequest[]): string {
  const bodies = reqs.map((r) => r.body).filter((b) => b.includes('Diagnose this run'));
  expect(bodies).toHaveLength(1);
  return bodies[0]!;
}

describe('--phase all vs --phase agent + --phase grade', () => {
  it.each([[[]], [['mcp']], [['skills']], [['mcp', 'skills']]] as string[][][])(
    'produces deep-equal JobResults and byte-identical LLM requests (tools=%j)',
    async (tools) => {
      const fullRoot = makeRoot(true);
      const all = await runAllPath(fullRoot, tools);
      // The agent phase runs against a root with NO graders.ts at all.
      const split = await runSplitPath(makeRoot(false), fullRoot, tools);

      expect(all.result.status).not.toBe('error');
      // Judge + analyst were really exercised and graders really ran.
      expect(all.requests.length).toBeGreaterThanOrEqual(3);
      if (all.result.status === 'error') throw new Error('unreachable');
      expect('graders' in all.result && all.result.graders.length).toBeGreaterThanOrEqual(4);

      // No field is excluded: the stub run is fully deterministic, and every time/random
      // value (session_id, wall_time, active_time, costs) comes from the stored RunRecord.
      expect(split.result).toEqual(all.result);
      expect(split.requests).toEqual(all.requests);
      expect(split.requests.map((r) => r.body)).toEqual(all.requests.map((r) => r.body));

      // The skill reaches the analyst only when it was in the agent's context. On the split
      // path the skills directory was gone during grading, so the content came from the
      // artefact's stored skillFiles.
      const stored = readRunArtifact(split.artifactDir);
      if (stored.kind !== 'agent') throw new Error('expected an agent artefact');
      if (tools.includes('skills')) {
        expect(stored.run.skillFiles?.map((f) => f.relPath)).toEqual(['SKILL.md', 'references/react.md']);
        expect(analystBody(split.requests)).toContain(SKILL_MARKER);
        expect(existsSync(skillsRoot)).toBe(false);
      } else {
        expect(stored.run.skillFiles).toBeUndefined();
        expect(analystBody(split.requests)).not.toContain(SKILL_MARKER);
      }
    },
  );

  it('keeps grading and the artefact usable more than once (read-only input)', async () => {
    const fullRoot = makeRoot(true);
    const split = await runSplitPath(makeRoot(false), fullRoot, []);
    const again = await gradeArtifact(
      readRunArtifact(split.artifactDir),
      new Map([[EVAL_ID, evalConfig]]),
      'key',
      fullRoot,
    );
    expect(again).toEqual(split.result);
    expect(readRunArtifact(split.artifactDir).manifest.workspaceFiles).toContain('.env');
  });

  it('snapshots the files graders will read, including agent-written .env', async () => {
    const root = makeRoot(false);
    const split = await runSplitPath(root, makeRoot(true), []);
    const art = readRunArtifact(split.artifactDir);
    expect(art.manifest.workspaceFiles).toEqual(['.env', 'logo.bin', 'src/App.tsx', 'src/main.tsx']);
  });

  it('error path: a runner failure yields the same error result on both paths', async () => {
    hoisted.runner.run = async () => {
      throw new Error('model exploded');
    };
    const fullRoot = makeRoot(true);
    const all = await runAllPath(fullRoot, []);
    const split = await runSplitPath(makeRoot(false), fullRoot, []).catch((e: unknown) => e);
    // runSplitPath asserts ok===true; for the error case drive the phases directly.
    expect(split).toBeInstanceOf(Error);

    const artifactRoot = tmp();
    const ok = await runAgentPhaseJob(evalConfig, MODEL, 'agent', [], 'key', false, AGENT_TYPE, fullRoot, artifactRoot);
    expect(ok).toBe(false);
    const [dir] = findRunArtifacts(artifactRoot);
    expect(readRunArtifact(dir!).kind).toBe('error');
    const graded = await gradeArtifact(readRunArtifact(dir!), new Map([[EVAL_ID, evalConfig]]), 'key', fullRoot);
    expect(graded).toEqual(all.result);
    expect(graded.status).toBe('error');
    expect((graded as { agent_type?: string }).agent_type).toBe(AGENT_TYPE);
  });

  it('baseline mode: same result on both paths', async () => {
    const baselineResult = {
      evalId: EVAL_ID,
      model: MODEL,
      mode: 'baseline',
      sessionId: 'fixed-baseline-session',
      responseText: 'import { Auth0Provider } from "@auth0/auth0-react"; <Auth0Provider>',
      inputTokens: 50,
      outputTokens: 20,
      costUsd: 0.002,
      wallTime: 3.25,
      status: 'success' as const,
      error: '',
    };
    hoisted.baseline.mockResolvedValue(baselineResult);
    const fullRoot = makeRoot(true);

    requests = [];
    const all = await runJob(evalConfig, MODEL, 'baseline', [], 'key', false, AGENT_TYPE, fullRoot, false);
    const allRequests = [...requests];

    const artifactRoot = tmp();
    requests = [];
    expect(
      await runAgentPhaseJob(
        evalConfig,
        MODEL,
        'baseline',
        [],
        'key',
        false,
        AGENT_TYPE,
        makeRoot(false),
        artifactRoot,
      ),
    ).toBe(true);
    expect(requests).toEqual([]);
    const [dir] = findRunArtifacts(artifactRoot);
    const graded = await gradeArtifact(readRunArtifact(dir!), new Map([[EVAL_ID, evalConfig]]), 'key', fullRoot);

    expect(graded).toEqual(all);
    expect(requests).toEqual(allRequests);
  });

  it('cleans the agent-phase workspace unless --keep-workspace is set', async () => {
    const root = makeRoot(false);
    const artifactRoot = tmp();
    await runAgentPhaseJob(evalConfig, MODEL, 'agent', [], 'key', false, AGENT_TYPE, root, artifactRoot);
    const art = readRunArtifact(findRunArtifacts(artifactRoot)[0]!);
    if (art.kind !== 'agent') throw new Error('unreachable');
    expect(existsSync(art.run.record.workspace)).toBe(false);

    const kept = tmp();
    await runAgentPhaseJob(evalConfig, MODEL, 'agent', [], 'key', true, AGENT_TYPE, root, kept);
    const keptArt = readRunArtifact(findRunArtifacts(kept)[0]!);
    if (keptArt.kind !== 'agent') throw new Error('unreachable');
    expect(existsSync(keptArt.run.record.workspace)).toBe(true);
    rmSync(keptArt.run.record.workspace, { recursive: true, force: true });
  });
});
