/**
 * Replay sub-command — checks a fixture eval's graders against scripted
 * solutions on a live tenant, with no LLM in the loop.
 *
 * Usage (via bin):
 *   a0-eval replay --eval <id>
 *
 * Each eval keeps its scripts in `replay/`:
 *   replay/reference.sh     — a correct solution; every non-judge grader must pass
 *   replay/mutants/*.sh     — broken solutions; each must fail at least one grader,
 *                             or every grader named in a `# breaks: <name>` line
 *
 * A script is a list of steps separated by blank lines. Each step runs as its own
 * `bash -c` in the workspace and is recorded as one `run_command` tool call, the
 * way an agent's shell calls are, so command graders see a realistic trace.
 * Comment lines are dropped. Steps get `RUN_ID` and every scalar seeded value
 * as `SEED_<KEY>` (e.g. `legacyAdminId` becomes `SEED_LEGACY_ADMIN_ID`).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  AGENT_LEVELS,
  VERIFIER_ENV,
  cleanupWorkspace,
  createManagementClient,
  discoverEvals,
  loadConfig,
  loadEval,
  logger,
  openFixture,
  readVerifierCredentials,
  redactKnownSecrets,
  redactSecrets,
  runCompileCommand,
  runGraders,
  runSetupCommand,
  setFrameworkConfig,
  setupWorkspace,
} from '@a0/evals-core';
import type { EvalDefinition, VerifierCredentials } from '@a0/evals-core';
import type { EventToolCall, GraderResult } from '@a0/evals-graders';

export interface ReplayOptions {
  eval: string;
  config?: string;
}

/** A parsed replay script. */
export interface ReplayScript {
  steps: string[];
  /** Grader names a mutant must fail, from `# breaks: <name>` lines. */
  breaks: string[];
}

const STEP_TIMEOUT_MS = 120_000;
const BREAKS_RE = /^#\s*breaks:\s*(.+)$/;

/** Splits a replay script into blank-line separated steps and collects `# breaks:` lines. */
export function parseReplayScript(text: string): ReplayScript {
  const breaks: string[] = [];
  const steps: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) steps.push(current.join('\n'));
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const directive = trimmed.match(BREAKS_RE);
    if (directive) {
      breaks.push(directive[1]!.trim());
      continue;
    }
    if (trimmed === '') {
      flush();
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    current.push(line);
  }
  flush();
  return { steps, breaks };
}

/** `legacyAdminId` -> `SEED_LEGACY_ADMIN_ID`. Only strings, numbers and booleans are exported. */
export function seededEnv(seeded: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(seeded)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const name = key
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .toUpperCase();
    env[`SEED_${name}`] = String(value);
  }
  return env;
}

/**
 * Decides whether a script did what it is for. The reference must pass every
 * grader. A mutant must fail every grader named in `breaks`, or at least one
 * grader when it names none.
 */
export function judgeReplay(
  kind: 'reference' | 'mutant',
  results: GraderResult[],
  breaks: string[],
): { ok: boolean; reason: string } {
  const failed = results.filter((r) => !r.passed).map((r) => r.name);
  if (kind === 'reference') {
    return failed.length === 0
      ? { ok: true, reason: 'all graders passed' }
      : { ok: false, reason: `reference failed: ${failed.join('; ')}` };
  }
  if (breaks.length === 0) {
    return failed.length > 0
      ? { ok: true, reason: `caught by: ${failed.join('; ')}` }
      : { ok: false, reason: 'mutant passed every grader' };
  }
  const known = new Set(results.map((r) => r.name));
  const unknown = breaks.filter((b) => !known.has(b));
  if (unknown.length > 0) return { ok: false, reason: `no grader named: ${unknown.join('; ')}` };
  const missed = breaks.filter((b) => !failed.includes(b));
  return missed.length === 0
    ? { ok: true, reason: `caught by: ${breaks.join('; ')}` }
    : { ok: false, reason: `expected to fail but passed: ${missed.join('; ')}` };
}

function runSteps(steps: string[], workspace: string, env: NodeJS.ProcessEnv): EventToolCall[] {
  return steps.map((command) => {
    const r = spawnSync('bash', ['-c', command], {
      cwd: workspace,
      env,
      encoding: 'utf-8',
      timeout: STEP_TIMEOUT_MS,
    });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    return { name: 'run_command', args: { command }, result: output, causedError: r.status !== 0 };
  });
}

async function replayScript(
  evalDef: EvalDefinition,
  credentials: VerifierCredentials,
  script: ReplayScript,
): Promise<{ results: GraderResult[]; failedSteps: string[] }> {
  const workspace = setupWorkspace(evalDef.scaffold);
  const session = await openFixture(evalDef.fixture!, { mgmt: createManagementClient(credentials), workspace });
  try {
    if (evalDef.setupCommand) runSetupCommand(workspace, evalDef.setupCommand);
    const env = { ...process.env, RUN_ID: session.context.runId, ...seededEnv(session.context.seeded) };
    const toolCalls = runSteps(script.steps, workspace, env);
    const secrets = [credentials.clientSecret, ...session.secrets];
    // A failing step usually means a broken script, not a grader verdict, so surface its output (redacted).
    const failedSteps = toolCalls.flatMap((tc, i) =>
      tc.causedError
        ? [`step ${i + 1} failed: ${redactSecrets(redactKnownSecrets(tc.result, secrets)).trim().slice(0, 300)}`]
        : [],
    );
    const compileResult =
      evalDef.compileCommand !== undefined
        ? runCompileCommand(workspace, evalDef.compileCommand, { setupCommand: evalDef.setupCommand })
        : undefined;
    const post = await session.snapshot();
    // Judges need an LLM, so replay grades only the deterministic graders.
    const graders = evalDef.graders.filter((g) => g.kind !== 'judge');
    const results = await runGraders(
      graders,
      workspace,
      '',
      undefined,
      AGENT_LEVELS,
      true,
      toolCalls,
      compileResult,
      '',
      {
        state: evalDef.fixture!.snapshot ? { pre: session.pre, post, seeded: session.context.seeded } : undefined,
        secrets,
      },
    );
    return { results, failedSteps };
  } finally {
    await session.close();
    cleanupWorkspace(workspace);
  }
}

export async function runReplay(opts: ReplayOptions): Promise<void> {
  loadDotenv();
  let credentials: VerifierCredentials | null;
  try {
    credentials = readVerifierCredentials();
  } finally {
    // Same rule as `run`: no child process (setup command, replay step) inherits the verifier.
    for (const key of Object.values(VERIFIER_ENV)) delete process.env[key];
  }

  const frameworkConfig = await loadConfig({ configPath: opts.config });
  setFrameworkConfig(frameworkConfig);
  const frameworkRoot = process.cwd();

  const evalCfg = discoverEvals(frameworkConfig.evalsDir, frameworkRoot).find((e) => e.id === opts.eval);
  if (!evalCfg) throw new Error(`No eval with id '${opts.eval}'`);
  const evalDef = await loadEval(evalCfg, frameworkRoot);
  if (!evalDef.fixture) throw new Error(`'${evalDef.id}' has no fixture.ts; replay needs a tenant fixture`);
  if (!credentials) {
    throw new Error(
      `No verifier credential set (${VERIFIER_ENV.file}, or ${VERIFIER_ENV.domain} + ${VERIFIER_ENV.clientId} + ${VERIFIER_ENV.clientSecret})`,
    );
  }

  const replayDir = join(evalDef.path, 'replay');
  const referencePath = join(replayDir, 'reference.sh');
  if (!existsSync(referencePath)) throw new Error(`Missing ${referencePath}`);
  const mutantsDir = join(replayDir, 'mutants');
  const mutantPaths = existsSync(mutantsDir)
    ? readdirSync(mutantsDir)
        .filter((f) => f.endsWith('.sh'))
        .sort()
        .map((f) => join(mutantsDir, f))
    : [];

  const scripts: Array<{ label: string; kind: 'reference' | 'mutant'; path: string }> = [
    { label: 'reference', kind: 'reference', path: referencePath },
    ...mutantPaths.map((p) => ({ label: `mutant ${basename(p, '.sh')}`, kind: 'mutant' as const, path: p })),
  ];

  // Sequential on purpose: scripts share one tenant, and parallel runs would race on it.
  let allOk = true;
  for (const { label, kind, path } of scripts) {
    logger.info(`\n[Replay] ${evalDef.id}: ${label}`);
    const script = parseReplayScript(readFileSync(path, 'utf-8'));
    const { results, failedSteps } = await replayScript(evalDef, credentials, script);
    for (const line of failedSteps) logger.warn(`  ${line}`);
    for (const r of results) logger.info(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.name}  | ${r.detail}`);
    const verdict = judgeReplay(kind, results, script.breaks);
    logger.info(`  ${verdict.ok ? '✓' : '✗'} ${label}: ${verdict.reason}`);
    allOk &&= verdict.ok;
  }

  if (!allOk) process.exit(1);
}
