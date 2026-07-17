import type { ToolCallRecord } from '@a0/evals-core';

export interface WasteAnalysis {
  totalCalls: number;
  wasteCount: number;
  duplicateReads: number;
  erroredOrRetry: number;
  overwrittenWrites: number;
  interruptions: number;
}

function filePath(tc: ToolCallRecord): string | undefined {
  return typeof tc.args['path'] === 'string' ? tc.args['path'] : undefined;
}

export function analyzeWaste(toolCalls: ToolCallRecord[]): WasteAnalysis {
  const total = toolCalls.length;

  // Each category tracks its own set of waste indices independently.
  // wasteCount is the union — a call that matches multiple categories
  // is counted once in wasteCount but appears in all matching category counts.
  const dupReadFlags = new Array<boolean>(total).fill(false);
  const errorFlags = new Array<boolean>(total).fill(false);
  const overwriteFlags = new Array<boolean>(total).fill(false);
  const interruptionFlags = new Array<boolean>(total).fill(false);

  // Duplicate reads: same path read twice with no intervening write_file to
  // that same path or any run_command (run_command may mutate any file).
  // Note: write_file to path B does NOT reset duplicate-read tracking for path A.
  const lastReadIndex = new Map<string, number>();
  for (const [i, tc] of toolCalls.entries()) {
    if (tc.name === 'run_command') {
      lastReadIndex.clear();
    } else if (tc.name === 'write_file') {
      const p = filePath(tc);
      if (p) lastReadIndex.delete(p);
    } else if (tc.name === 'read_file') {
      const p = filePath(tc);
      if (p) {
        if (lastReadIndex.has(p)) {
          dupReadFlags[i] = true;
        } else {
          lastReadIndex.set(p, i);
        }
      }
    }
  }

  // Errored calls and retries.
  for (const [i, tc] of toolCalls.entries()) {
    if (tc.causedError || tc.isRetry) errorFlags[i] = true;
  }

  // Overwritten writes: write_file to path X followed by another write_file
  // to path X with no intervening read_file to X (the first write was discarded).
  const lastWriteIndex = new Map<string, number>();
  for (const [i, tc] of toolCalls.entries()) {
    if (tc.name === 'write_file') {
      const p = filePath(tc);
      if (p) {
        const prior = lastWriteIndex.get(p);
        if (prior !== undefined) overwriteFlags[prior] = true;
        lastWriteIndex.set(p, i);
      }
    } else if (tc.name === 'read_file') {
      const p = filePath(tc);
      if (p) lastWriteIndex.delete(p);
    }
  }

  // Interruptions (ask_user). Intentionally double-counted with Setup Friction:
  // Friction penalises user disruption; Efficiency penalises the wasted call slot.
  for (const [i, tc] of toolCalls.entries()) {
    if (tc.isInterruption) interruptionFlags[i] = true;
  }

  // wasteCount = union of all category flags (each call counted at most once).
  let wasteCount = 0;
  for (let i = 0; i < total; i++) {
    if (dupReadFlags[i] || errorFlags[i] || overwriteFlags[i] || interruptionFlags[i]) wasteCount++;
  }

  return {
    totalCalls: total,
    wasteCount,
    duplicateReads: dupReadFlags.filter(Boolean).length,
    erroredOrRetry: errorFlags.filter(Boolean).length,
    overwrittenWrites: overwriteFlags.filter(Boolean).length,
    interruptions: interruptionFlags.filter(Boolean).length,
  };
}
