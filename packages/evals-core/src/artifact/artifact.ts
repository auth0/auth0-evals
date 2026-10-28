/**
 * Run artefacts — the hand-off between the agent phase and the grade phase.
 *
 * An artefact is a directory:
 *
 *   manifest.json   metadata; written LAST, so its presence means the artefact is complete
 *   run.json        kind-specific payload (RunRecord, baseline response, or error text)
 *   workspace/      agent kind only: byte-exact snapshot of the files graders will read
 *
 * SECURITY: artefacts contain the UNREDACTED trace (tool args and results) and every
 * file the agent wrote (including e.g. `.env`). Graders need the raw trace, so nothing
 * is redacted here — redaction happens later, in the serialisers. Treat artefact
 * directories as sensitive: do not publish or share them.
 *
 * Workspace snapshot rationale: every grading-time reader (graders engine, recommendations)
 * lists files through `listGradingFiles(workspace)`. The snapshot copies exactly that list,
 * so a restored directory yields an identical listing. If the original listing was
 * truncated at the file cap, the restored directory holds exactly the capped files and
 * re-truncates identically.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { listGradingFiles } from '../graders/engine.js';
import { logger } from '../utils/logger.js';
import { resolveInside } from '../workspace/path-utils.js';
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_RUN_FILE,
  ARTIFACT_WORKSPACE_DIR,
  RUN_ARTIFACT_SCHEMA_VERSION,
} from './types.js';
import type {
  AgentRunData,
  ArtifactManifest,
  BaselineRunData,
  ErrorRunData,
  RunArtifact,
  RunArtifactKind,
  WriteRunArtifactInput,
} from './types.js';

const KINDS: readonly RunArtifactKind[] = ['agent', 'baseline', 'error'];

function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  writeFileSync(tmp, data, 'utf-8');
  renameSync(tmp, path);
}

/**
 * Copies the grading-visible files of `workspace` into `<destRoot>`, byte-exact.
 * Returns the copied list, the listed files that could not be copied, and whether the
 * original listing was truncated.
 *
 * A file that cannot be copied is skipped with a warning instead of failing the run:
 * grading under `--phase all` skips unreadable files the same way, so the graders' file
 * map is unchanged, and a finished (paid) agent run is not lost to one bad file.
 */
function snapshotWorkspace(
  workspace: string,
  destRoot: string,
): { files: string[]; skipped: string[]; truncated: boolean } {
  const { files: candidates, truncated } = listGradingFiles(workspace);

  mkdirSync(destRoot, { recursive: true });
  const srcReal = realpathSync(workspace);
  const destReal = realpathSync(destRoot);
  const files: string[] = [];
  const skipped: string[] = [];
  for (const rel of candidates) {
    try {
      const src = resolveInside(srcReal, rel);
      const dest = resolveInside(destReal, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      files.push(rel);
    } catch (e) {
      skipped.push(rel);
      logger.warn(`[Artefact] Skipping workspace file ${rel}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { files, skipped, truncated };
}

/**
 * Writes a run artefact to `dir` (created if needed). `run.json` and `manifest.json` are
 * written atomically (tmp + rename), manifest last. Re-writing an existing artefact removes
 * its manifest first so a half-written artefact is never mistaken for a complete one.
 *
 * Contains unredacted traces and agent-written files — see the module note.
 */
export function writeRunArtifact(dir: string, input: WriteRunArtifactInput): void {
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, ARTIFACT_MANIFEST_FILE), { force: true });
  rmSync(join(dir, ARTIFACT_WORKSPACE_DIR), { recursive: true, force: true });

  const manifest: ArtifactManifest = {
    schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
    kind: input.kind,
    evalId: input.evalId,
    category: input.category,
    model: input.model,
    mode: input.mode,
    tools: input.tools,
    ...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };

  let run: AgentRunData | BaselineRunData | ErrorRunData;
  if (input.kind === 'agent') {
    const { files, skipped, truncated } = snapshotWorkspace(input.workspace, join(dir, ARTIFACT_WORKSPACE_DIR));
    manifest.workspaceFiles = files;
    if (skipped.length > 0) manifest.workspaceSkipped = skipped;
    manifest.workspaceTruncated = truncated;
    run = {
      record: input.record,
      resolvedModel: input.resolvedModel,
      ...(input.compileResult !== undefined ? { compileResult: input.compileResult } : {}),
      ...(input.skillFiles !== undefined ? { skillFiles: input.skillFiles } : {}),
    };
  } else if (input.kind === 'baseline') {
    run = { result: input.result, responseText: input.responseText };
  } else {
    run = { error: input.error };
  }

  atomicWrite(join(dir, ARTIFACT_RUN_FILE), JSON.stringify(run, null, 2));
  atomicWrite(join(dir, ARTIFACT_MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

function readJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  } catch (e) {
    throw new Error(`Invalid run artefact: cannot read ${what} at ${path}: ${e instanceof Error ? e.message : e}`, {
      cause: e,
    });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Reads and validates only `manifest.json` of the artefact in `dir`, without parsing the
 * (possibly large) `run.json`. Use it to filter artefacts before {@link readRunArtifact}.
 */
export function readRunArtifactManifest(dir: string): ArtifactManifest {
  const manifestPath = join(dir, ARTIFACT_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`Invalid run artefact: ${manifestPath} not found (artefact missing or incomplete)`);
  }
  const manifest = readJson(manifestPath, 'manifest.json');
  if (!isObject(manifest)) throw new Error(`Invalid run artefact: ${manifestPath} is not a JSON object`);
  if (manifest.schemaVersion !== RUN_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported run artefact schemaVersion ${JSON.stringify(manifest.schemaVersion)} in ${manifestPath} ` +
        `(this build supports ${RUN_ARTIFACT_SCHEMA_VERSION})`,
    );
  }
  const kind = manifest.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as RunArtifactKind)) {
    throw new Error(`Invalid run artefact kind ${JSON.stringify(kind)} in ${manifestPath}`);
  }
  for (const field of ['evalId', 'category', 'model', 'mode'] as const) {
    if (typeof manifest[field] !== 'string') {
      throw new Error(`Invalid run artefact: manifest field '${field}' missing in ${manifestPath}`);
    }
  }
  if (!Array.isArray(manifest.tools)) {
    throw new Error(`Invalid run artefact: manifest field 'tools' missing in ${manifestPath}`);
  }
  return manifest as unknown as ArtifactManifest;
}

/**
 * Reads and validates the artefact in `dir`. Rejects unknown schema versions and kinds.
 * Never mutates the artefact.
 */
export function readRunArtifact(dir: string): RunArtifact {
  const m = readRunArtifactManifest(dir);
  const kind = m.kind;
  const runPath = join(dir, ARTIFACT_RUN_FILE);
  const run = readJson(runPath, 'run.json');
  if (!isObject(run)) throw new Error(`Invalid run artefact: ${runPath} is not a JSON object`);

  if (kind === 'agent') {
    if (!isObject(run.record) || typeof run.resolvedModel !== 'string') {
      throw new Error(`Invalid run artefact: ${runPath} lacks record/resolvedModel for kind 'agent'`);
    }
    return { dir, kind, manifest: m, run: run as unknown as AgentRunData };
  }
  if (kind === 'baseline') {
    if (!isObject(run.result) || typeof run.responseText !== 'string') {
      throw new Error(`Invalid run artefact: ${runPath} lacks result/responseText for kind 'baseline'`);
    }
    return { dir, kind, manifest: m, run: run as unknown as BaselineRunData };
  }
  if (typeof run.error !== 'string') {
    throw new Error(`Invalid run artefact: ${runPath} lacks error for kind 'error'`);
  }
  return { dir, kind: 'error', manifest: m, run: run as unknown as ErrorRunData };
}

/**
 * Recursively finds artefact directories (those containing `manifest.json`) under `rootDir`.
 * Returns absolute paths, sorted.
 *
 * Never descends into an artefact, complete or not: its `workspace/` holds the agent's
 * files, which may include an unrelated `manifest.json` (e.g. a web app manifest). A
 * directory with `run.json` or `workspace/` but no manifest is an artefact whose writer
 * stopped before finishing; it is skipped with a warning, not reported as found.
 */
export function findRunArtifacts(rootDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (existsSync(join(dir, ARTIFACT_MANIFEST_FILE))) {
      found.push(dir);
      return;
    }
    if (existsSync(join(dir, ARTIFACT_RUN_FILE)) || existsSync(join(dir, ARTIFACT_WORKSPACE_DIR))) {
      logger.warn(`[Artefact] Skipping incomplete artefact (no ${ARTIFACT_MANIFEST_FILE}): ${dir}`);
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
    }
  };
  const root = resolve(rootDir);
  if (existsSync(root) && statSync(root).isDirectory()) walk(root);
  return found.sort();
}

/**
 * Returns the absolute path of the artefact's `workspace/` directory, ready to grade against.
 * Grading reads it in place; callers must not mutate it. Verifies every file listed in the
 * manifest is present. Takes an artefact already read with {@link readRunArtifact}.
 */
export function restoreArtifactWorkspace(artifact: RunArtifact): string {
  if (artifact.kind !== 'agent') {
    throw new Error(`Run artefact ${artifact.dir} has kind '${artifact.kind}' and no workspace`);
  }
  const wsDir = join(artifact.dir, ARTIFACT_WORKSPACE_DIR);
  if (!existsSync(wsDir) || !statSync(wsDir).isDirectory()) {
    throw new Error(`Invalid run artefact: ${wsDir} is missing`);
  }
  const wsReal = realpathSync(wsDir);
  for (const rel of artifact.manifest.workspaceFiles ?? []) {
    if (!existsSync(resolveInside(wsReal, rel))) {
      throw new Error(`Invalid run artefact: workspace file missing: ${rel}`);
    }
  }
  return wsReal;
}
