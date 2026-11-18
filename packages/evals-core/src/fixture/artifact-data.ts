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

import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixtureState } from '@a0/evals-graders';
import { listGradingFiles } from '../graders/engine.js';
import { findSecretExposure } from '../graders/secret-exposure.js';
import type { SecretEvidence, SecretExposure } from '../graders/secret-exposure.js';
import type { FixtureGradingInput } from '../graders/engine.js';
import { REDACTION_MARKER, redactKnownSecrets } from '../utils/redact.js';

export interface FixtureArtifactData {
  /** Masked snapshots; absent when the fixture has no snapshot hook, or when the session recorded a snapshot failure (see `stateError`). */
  state?: FixtureState;
  /** Why `state` is missing after a failed snapshot. Short and secret free. */
  stateError?: string;
  exposure: SecretExposure;
}

/**
 * True when any object key anywhere in `value` contains a known secret. Keys cannot be masked
 * safely: two keys that differ only in the secret would collapse into one.
 */
function hasSecretKey(value: unknown, secrets: readonly string[], seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((v) => hasSecretKey(v, secrets, seen));
  return Object.entries(value).some(
    ([key, inner]) => secrets.some((s) => key.includes(s)) || hasSecretKey(inner, secrets, seen),
  );
}

/**
 * Masks known secrets out of a snapshot with one marker per distinct secret, `[REDACTED SECRET 1]`,
 * `[REDACTED SECRET 2]`, and so on. The same secret always gets the same marker and different
 * secrets never share one, so a `tenantState` predicate that compares two credentials (for example
 * "was the secret rotated?") reaches the same verdict on the masked state as on the live one.
 */
function maskStateSecrets<T>(value: T, secrets: readonly string[]): T {
  const distinct = [...new Set(secrets.filter((s) => s.length > 0))];
  if (distinct.length === 0) return value;
  // Longest first, so a secret that contains another one is masked whole instead of leaving its tail.
  const ordered = distinct
    .map((secret, i) => ({ secret, marker: `${REDACTION_MARKER.slice(0, -1)} ${i + 1}]` }))
    .sort((a, b) => b.secret.length - a.secret.length);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return ordered.reduce((out, { secret, marker }) => out.split(secret).join(marker), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).map(([k, inner]) => [k, walk(inner)]));
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * Runs at the end of the agent phase, before anything is masked: scans the evidence for the known
 * secrets, then masks them out of the snapshots. Does not mutate its inputs. Throws, without
 * quoting the key, when a snapshot key contains a known secret.
 */
export function sealFixtureData(input: FixtureGradingInput, evidence: SecretEvidence): FixtureArtifactData {
  const exposure = findSecretExposure(input.secrets, evidence);
  const known = input.secrets.filter((s) => s.length > 0);
  if (input.state !== undefined && hasSecretKey(input.state, known)) {
    throw new Error('A tenant snapshot key contains a known secret, so the state cannot be stored safely');
  }
  return {
    ...(input.state !== undefined ? { state: maskStateSecrets(input.state, input.secrets) } : {}),
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
 * Prepares the grading-corpus workspace files for the artefact. Returns how many files it changed.
 *
 * - A file that contains a known secret is rewritten with the exact values masked. Files without a
 *   secret are not touched. Files that cannot be read are skipped, because the workspace snapshot
 *   skips them too.
 * - A file whose path contains a known secret is deleted, so the artefact neither copies it nor
 *   lists its path. A path cannot be masked without changing the file it names. The exposure scan
 *   runs on the unmasked evidence first (see `sealFixtureData`), so `secret_not_exposed` still
 *   fails for it, the same as in a combined run.
 *
 * Fails closed: a file that holds a secret but cannot be rewritten or deleted (after one retry that
 * makes it writable) throws, because the snapshot would otherwise copy it into the artefact. The
 * error never quotes the path.
 */
export function maskWorkspaceSecrets(workspace: string, secrets: readonly string[]): number {
  const known = secrets.filter((s) => s.length > 0);
  if (known.length === 0) return 0;
  let changed = 0;
  for (const rel of listGradingFiles(workspace).files) {
    const path = join(workspace, rel);
    if (known.some((s) => rel.includes(s))) {
      try {
        rmSync(path, { force: true });
      } catch {
        throw new Error('Cannot remove a workspace file whose path contains a known secret');
      }
      changed++;
      continue;
    }
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
    changed++;
  }
  return changed;
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
