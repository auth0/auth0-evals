/**
 * Fixture data in a run artefact.
 *
 * The agent phase holds the tenant snapshots and the known secrets. The grade phase has
 * neither a tenant nor any secret values, so the agent phase works out what the fixture
 * graders need, masks every known secret out of it, and stores only that:
 *
 *   - the masked snapshots (for tenant_state graders)
 *   - a report of WHERE a secret appeared, never the value (for secret_not_exposed)
 */

import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixtureState } from '@a0/evals-graders';
import { listGradingFiles } from '../graders/engine.js';
import { findSecretExposure } from '../graders/secret-exposure.js';
import type { SecretEvidence, SecretExposure } from '../graders/secret-exposure.js';
import type { FixtureGradingInput } from '../graders/engine.js';
import { redactKnownSecrets } from '../utils/redact.js';

export interface FixtureArtifactData {
  /** Masked snapshots; absent when the fixture has no snapshot hook, or when the session recorded a snapshot failure (see `stateError`). */
  state?: FixtureState;
  /** Why `state` is missing after a failed snapshot. Short and secret free. */
  stateError?: string;
  exposure: SecretExposure;
}

/**
 * Runs at the end of the agent phase, before anything is masked: scans the evidence for the known
 * secrets, then masks them out of the snapshots. Does not mutate its inputs.
 */
export function sealFixtureData(input: FixtureGradingInput, evidence: SecretEvidence): FixtureArtifactData {
  const exposure = findSecretExposure(input.secrets, evidence);
  return {
    ...(input.state !== undefined ? { state: redactKnownSecrets(input.state, input.secrets) } : {}),
    ...(input.stateError !== undefined ? { stateError: input.stateError } : {}),
    exposure,
  };
}

/**
 * Rebuilds the grading input in the grade phase. `secrets` is empty on purpose: the grade job
 * never sees secret values.
 */
export function fixtureGradingFromArtifact(data: FixtureArtifactData): FixtureGradingInput {
  return {
    secrets: [],
    ...(data.state !== undefined ? { state: data.state } : {}),
    ...(data.stateError !== undefined ? { stateError: data.stateError } : {}),
    exposure: data.exposure,
  };
}

/**
 * Rewrites every grading-corpus file that contains a known secret, masking exact values. Returns how
 * many files were rewritten. Files without a secret are not touched. Files that cannot be read are
 * skipped, because the workspace snapshot skips them too. Fails closed: a file that was read and
 * holds a secret but cannot be rewritten (after one retry that makes it writable) throws, because
 * the snapshot would otherwise copy the unmasked file into the artefact.
 */
export function maskWorkspaceSecrets(workspace: string, secrets: readonly string[]): number {
  const known = secrets.filter((s) => s.length > 0);
  if (known.length === 0) return 0;
  let rewritten = 0;
  for (const rel of listGradingFiles(workspace).files) {
    const path = join(workspace, rel);
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      continue; // unreadable files are skipped, the snapshot skips them too
    }
    if (!known.some((s) => content.includes(s))) continue;
    const masked = redactKnownSecrets(content, known);
    try {
      writeMasked(path, masked);
    } catch {
      throw new Error(`Cannot mask a known secret in workspace file ${rel}: the file could not be rewritten`);
    }
    rewritten++;
  }
  return rewritten;
}

/** Writes `content`, retrying once with the owner write bit added when the first write is refused. */
function writeMasked(path: string, content: string): void {
  try {
    writeFileSync(path, content, 'utf-8');
  } catch {
    chmodSync(path, statSync(path).mode | 0o200);
    writeFileSync(path, content, 'utf-8');
  }
}
