import type { CompileResult } from '@a0/evals-graders';
import type { AgentType } from '../types/agents.js';
import type { RunRecord } from '../types/scorer.js';
import type { BaselineResult } from '../serializers.js';

/** Current on-disk schema version of a run artefact. Bump on any incompatible change. */
export const RUN_ARTIFACT_SCHEMA_VERSION = 1;

/** Name of the manifest file; its presence marks an artefact directory as complete. */
export const ARTIFACT_MANIFEST_FILE = 'manifest.json';
/** Name of the file carrying the kind-specific run payload. */
export const ARTIFACT_RUN_FILE = 'run.json';
/** Name of the directory holding the snapshotted workspace (agent kind only). */
export const ARTIFACT_WORKSPACE_DIR = 'workspace';

export type RunArtifactKind = 'agent' | 'baseline' | 'error';

/**
 * Structural twin of `SkillFile` in the evals package (recommendations/collect-skill-content.ts),
 * duplicated here so core does not depend on the evals package.
 */
export interface ArtifactSkillFile {
  /** Skill name the file belongs to. */
  skill: string;
  /** Path relative to the skill directory, e.g. `references/feature-mfa/index.md`. */
  relPath: string;
  content: string;
}

/** `manifest.json` — written last, so its presence means the artefact is complete. */
export interface ArtifactManifest {
  schemaVersion: number;
  kind: RunArtifactKind;
  evalId: string;
  category: string;
  model: string;
  mode: 'baseline' | 'agent';
  tools: string[];
  agentType?: AgentType;
  /** ISO-8601 creation time. */
  createdAt: string;
  /** Agent kind only: workspace files snapshotted under `workspace/`, as returned by `listGradingFiles`. */
  workspaceFiles?: string[];
  /**
   * Agent kind only: listed files that could not be copied (e.g. unreadable, or deleted
   * after listing). Grading skips unreadable files too, so they are left out, not fatal.
   */
  workspaceSkipped?: string[];
  /** Agent kind only: true when the original workspace listing hit the file cap. */
  workspaceTruncated?: boolean;
}

/** `run.json` payload for the agent kind. */
export interface AgentRunData {
  record: RunRecord;
  resolvedModel: string;
  compileResult?: CompileResult;
  skillFiles?: ArtifactSkillFile[];
}

/** `run.json` payload for the baseline kind. */
export interface BaselineRunData {
  result: BaselineResult;
  responseText: string;
}

/** `run.json` payload for the error kind. */
export interface ErrorRunData {
  error: string;
}

interface WriteBase {
  evalId: string;
  category: string;
  model: string;
  tools: string[];
  agentType?: AgentType;
  /** Override for the manifest timestamp (defaults to now). */
  createdAt?: Date;
}

/** Input for {@link writeRunArtifact}. */
export type WriteRunArtifactInput =
  | (WriteBase & AgentRunData & { kind: 'agent'; mode: 'agent'; workspace: string })
  | (WriteBase & BaselineRunData & { kind: 'baseline'; mode: 'baseline' })
  | (WriteBase & ErrorRunData & { kind: 'error'; mode: 'baseline' | 'agent' });

/** A validated artefact read from disk. */
export type RunArtifact =
  | { dir: string; kind: 'agent'; manifest: ArtifactManifest; run: AgentRunData }
  | { dir: string; kind: 'baseline'; manifest: ArtifactManifest; run: BaselineRunData }
  | { dir: string; kind: 'error'; manifest: ArtifactManifest; run: ErrorRunData };
