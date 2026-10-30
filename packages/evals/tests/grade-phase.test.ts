/**
 * Grade-phase artefact selection and output handling (`runGradePhase`, `selectArtifacts`).
 *
 * Uses `error` artefacts, which the grade phase turns into results without loading an
 * eval or calling an LLM, so these tests exercise selection, de-duplication and the
 * output file without any network.
 */

import { describe, it, expect, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeRunArtifact, readRunArtifact, findRunArtifacts, logger } from '@a0/evals-core';
import type { RunArtifact } from '@a0/evals-core';
import { agentJobIdentity, buildJobList, runGradePhase, selectArtifacts } from '../src/cli/run.js';
import type { AgentType, EvalConfig } from '@a0/evals-core';
import type { GradePhaseOptions } from '../src/cli/run.js';
import { makeTmpDir } from './tmp.js';

const tmp = makeTmpDir('grade_phase_');

interface Spec {
  name: string;
  evalId?: string;
  model?: string;
  mode?: 'agent' | 'baseline';
  tools?: string[];
  agentType?: AgentType;
  createdAt: string;
  error?: string;
}

function writeError(root: string, spec: Spec): void {
  const mode = spec.mode ?? 'agent';
  writeRunArtifact(join(root, spec.name), {
    kind: 'error',
    evalId: spec.evalId ?? 'react_quickstart',
    category: 'quickstarts',
    model: spec.model ?? 'claude-sonnet-5',
    mode,
    tools: spec.tools ?? [],
    ...(mode === 'agent' ? { agentType: spec.agentType ?? 'claude-code' } : {}),
    createdAt: new Date(spec.createdAt),
    error: spec.error ?? `error from ${spec.name}`,
  });
}

function readAll(root: string): RunArtifact[] {
  return findRunArtifacts(root).map((d) => readRunArtifact(d));
}

function options(
  frameworkRoot: string,
  artifactDir: string,
  extra: Partial<GradePhaseOptions> = {},
): GradePhaseOptions {
  return {
    registry: [],
    artifactDir,
    evalIds: [],
    filters: {},
    workers: 2,
    apiKey: 'key',
    frameworkRoot,
    outputOverride: undefined,
    braintrust: false,
    ...extra,
  };
}

describe('selectArtifacts', () => {
  it('keeps only the newest artefact per eval/model/mode/tools, whatever the directory order', () => {
    const root = tmp();
    writeError(root, { name: 'z-old', createdAt: '2026-10-01T00:00:00Z' });
    writeError(root, { name: 'a-new', createdAt: '2026-10-02T00:00:00Z' });
    writeError(root, { name: 'm-other-tools', tools: ['skills'], createdAt: '2026-09-01T00:00:00Z' });
    const { selected, superseded } = selectArtifacts(readAll(root), [], {});
    expect(selected.map((a) => a.dir.split('/').pop()).sort()).toEqual(['a-new', 'm-other-tools']);
    expect(superseded.map((a) => a.dir.split('/').pop())).toEqual(['z-old']);
  });

  it('treats tool order and duplicates as the same key', () => {
    const root = tmp();
    writeError(root, { name: 'one', tools: ['mcp', 'skills'], createdAt: '2026-10-01T00:00:00Z' });
    writeError(root, { name: 'two', tools: ['skills', 'mcp', 'mcp'], createdAt: '2026-10-02T00:00:00Z' });
    expect(selectArtifacts(readAll(root), [], {}).selected.map((a) => a.dir.split('/').pop())).toEqual(['two']);
  });

  it('applies --eval, --model, --mode, --tools and --agent-type filters', () => {
    const root = tmp();
    const t = '2026-10-01T00:00:00Z';
    writeError(root, { name: 'agent-claude', createdAt: t });
    writeError(root, { name: 'agent-codex', model: 'gpt-5.6-sol', agentType: 'codex', createdAt: t });
    writeError(root, { name: 'agent-skills', tools: ['skills'], createdAt: t });
    writeError(root, { name: 'baseline', mode: 'baseline', createdAt: t });
    writeError(root, { name: 'other-eval', evalId: 'vue_quickstart', createdAt: t });
    const all = readAll(root);
    const names = (r: { selected: RunArtifact[] }): string[] => r.selected.map((a) => a.dir.split('/').pop()!).sort();

    expect(names(selectArtifacts(all, ['vue_quickstart'], {}))).toEqual(['other-eval']);
    expect(names(selectArtifacts(all, [], { models: ['gpt-5.6-sol'] }))).toEqual(['agent-codex']);
    expect(names(selectArtifacts(all, [], { modes: ['baseline'] }))).toEqual(['baseline']);
    expect(names(selectArtifacts(all, [], { agentType: 'codex' }))).toEqual(['agent-codex', 'baseline']);
    // --tools filters agent artefacts only; baseline runs never take tools.
    expect(names(selectArtifacts(all, [], { tools: ['skills'] }))).toEqual(['agent-skills', 'baseline']);
    expect(names(selectArtifacts(all, [], { modes: ['agent'], tools: [] }))).toEqual([
      'agent-claude',
      'agent-codex',
      'other-eval',
    ]);
  });
});

describe('agentJobIdentity', () => {
  const cfg: EvalConfig = { id: 'e', name: 'e', category: 'c', path: 'src/evals/c/e' };
  const models = ['claude-sonnet-5', 'gpt-5.6-sol', 'gemini-3.8-flash', 'some-other-model'];
  const agentTypes: Array<AgentType | undefined> = [undefined, 'claude-code', 'codex', 'gemini-cli', 'copilot'];

  it.each(models.flatMap((m) => agentTypes.map((t) => [m, t] as const)))(
    'matches what buildJobList records for --model %s --agent-type %s',
    (model, agentType) => {
      const [job] = buildJobList([cfg], [model], ['agent'], [], agentType);
      expect(agentJobIdentity(model, agentType)).toEqual({ agentType: job![4], model: job![1] });
    },
  );
});

describe('selectArtifacts — cross-family agent types', () => {
  it('finds the claude-code sentinel run for --agent-type claude-code --model <non-claude>', () => {
    const root = tmp();
    const t = '2026-10-01T00:00:00Z';
    writeError(root, { name: 'cc-sentinel', model: 'claude-code', agentType: 'claude-code', createdAt: t });
    writeError(root, { name: 'codex-gpt', model: 'gpt-5.6-sol', agentType: 'codex', createdAt: t });
    const all = readAll(root);
    const names = (r: { selected: RunArtifact[] }): string[] => r.selected.map((a) => a.dir.split('/').pop()!);

    expect(names(selectArtifacts(all, [], { models: ['gpt-5.6-sol'], agentType: 'claude-code' }))).toEqual([
      'cc-sentinel',
    ]);
    // Without --agent-type, a GPT model routes to codex, as it would when running jobs.
    expect(names(selectArtifacts(all, [], { models: ['gpt-5.6-sol'] }))).toEqual(['codex-gpt']);
  });
});

describe('runGradePhase', () => {
  it('names the output from an explicit --mode, like the all path', async () => {
    const frameworkRoot = tmp();
    const artifacts = join(frameworkRoot, 'art');
    writeError(artifacts, { name: 'a', createdAt: '2026-10-01T00:00:00Z' });
    const outcome = await runGradePhase(
      options(frameworkRoot, artifacts, { filters: { modes: ['baseline', 'agent'] } }),
    );
    expect(outcome.outputPath).toBe(join(frameworkRoot, 'scores-all-modes.json'));
  });

  it('ignores a broken artefact outside the filters instead of failing', async () => {
    const frameworkRoot = tmp();
    const artifacts = join(frameworkRoot, 'art');
    writeError(artifacts, { name: 'eval-a', createdAt: '2026-10-01T00:00:00Z' });
    // Readable manifest for another eval, corrupt run.json: never parsed.
    writeError(artifacts, { name: 'eval-b', evalId: 'vue_quickstart', createdAt: '2026-10-01T00:00:00Z' });
    writeFileSync(join(artifacts, 'eval-b', 'run.json'), '{corrupt');
    // Unreadable manifest: cannot be matched, so ignored when filtering.
    mkdirSync(join(artifacts, 'broken'), { recursive: true });
    writeFileSync(join(artifacts, 'broken', 'manifest.json'), '{corrupt');

    const errors = vi.spyOn(logger, 'error');
    const outcome = await runGradePhase(options(frameworkRoot, artifacts, { evalIds: ['react_quickstart'] }));
    expect(outcome.results.map((r) => r.eval_id)).toEqual(['react_quickstart']);
    // `failed` is true only because error artefacts become error results; eval-b and the
    // broken manifest are never reported as read failures.
    expect(errors.mock.calls.flat().join('\n')).not.toMatch(/Cannot read artefact/);
    errors.mockRestore();
  });

  it('fails when a selected artefact has a corrupt run.json', async () => {
    const frameworkRoot = tmp();
    const artifacts = join(frameworkRoot, 'art');
    writeError(artifacts, { name: 'a', createdAt: '2026-10-01T00:00:00Z' });
    writeFileSync(join(artifacts, 'a', 'run.json'), '{corrupt');
    const outcome = await runGradePhase(options(frameworkRoot, artifacts));
    expect(outcome).toEqual({ results: [], outputPath: undefined, failed: true });
  });

  it('grades only the newest duplicate and writes scores-<mode>.json', async () => {
    const frameworkRoot = tmp();
    const artifacts = join(frameworkRoot, 'art');
    writeError(artifacts, { name: 'run-2', createdAt: '2026-10-02T00:00:00Z', error: 'newer' });
    writeError(artifacts, { name: 'run-1', createdAt: '2026-10-01T00:00:00Z', error: 'older' });

    const outcome = await runGradePhase(options(frameworkRoot, artifacts));
    expect(outcome.results).toHaveLength(1);
    expect(outcome.outputPath).toBe(join(frameworkRoot, 'scores-agent.json'));
    const saved = JSON.parse(readFileSync(outcome.outputPath!, 'utf-8')) as Array<{ error: string }>;
    expect(saved.map((r) => r.error)).toEqual(['newer']);
    // Error results fail the phase, exactly like the `all` path.
    expect(outcome.failed).toBe(true);
  });

  it('names the output from the modes graded, after filtering', async () => {
    const frameworkRoot = tmp();
    const artifacts = join(frameworkRoot, 'art');
    writeError(artifacts, { name: 'a', createdAt: '2026-10-01T00:00:00Z' });
    writeError(artifacts, { name: 'b', mode: 'baseline', createdAt: '2026-10-01T00:00:00Z' });

    const mixed = await runGradePhase(options(frameworkRoot, artifacts));
    expect(mixed.outputPath).toBe(join(frameworkRoot, 'scores-all-modes.json'));
    const filtered = await runGradePhase(options(frameworkRoot, artifacts, { filters: { modes: ['agent'] } }));
    expect(filtered.outputPath).toBe(join(frameworkRoot, 'scores-agent.json'));
    expect(filtered.results).toHaveLength(1);
  });

  it('writes nothing (no scores-undefined.json) when every artefact is unreadable', async () => {
    const frameworkRoot = tmp();
    const bad = join(frameworkRoot, 'art', 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'manifest.json'), '{not json');

    const outcome = await runGradePhase(options(frameworkRoot, join(frameworkRoot, 'art')));
    expect(outcome).toEqual({ results: [], outputPath: undefined, failed: true });
    expect(readdirSync(frameworkRoot).filter((f) => f.startsWith('scores-'))).toEqual([]);
  });

  it('fails without writing when filters match nothing', async () => {
    const frameworkRoot = tmp();
    const artifacts = join(frameworkRoot, 'art');
    writeError(artifacts, { name: 'a', createdAt: '2026-10-01T00:00:00Z' });
    const outcome = await runGradePhase(options(frameworkRoot, artifacts, { evalIds: ['nope'] }));
    expect(outcome.failed).toBe(true);
    expect(existsSync(join(frameworkRoot, 'scores-agent.json'))).toBe(false);
  });

  it('still grades readable artefacts when one is unreadable, and reports failure', async () => {
    const frameworkRoot = tmp();
    const artifacts = join(frameworkRoot, 'art');
    writeError(artifacts, { name: 'good', createdAt: '2026-10-01T00:00:00Z' });
    mkdirSync(join(artifacts, 'broken'), { recursive: true });
    writeFileSync(join(artifacts, 'broken', 'manifest.json'), '{}');
    const outcome = await runGradePhase(options(frameworkRoot, artifacts));
    expect(outcome.results).toHaveLength(1);
    expect(outcome.failed).toBe(true);
  });
});
