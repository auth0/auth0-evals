import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Spawns a single-eval subprocess and waits for it to exit cleanly.
 * The subprocess runs `selfPath --eval <evalId> ...args`.
 */
export function spawnEval(selfPath: string, evalId: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [selfPath, '--eval', evalId, ...args], {
      stdio: 'inherit',
    });
    child.on('close', (code, signal) => {
      if (code === 0 && signal === null) {
        resolve();
      } else {
        reject(new Error(`'${evalId}' subprocess exited with code ${code} and signal ${signal ?? 'null'}`));
      }
    });
    child.on('error', reject);
  });
}

/**
 * Reads each temp file, collects all results into a flat array, and deletes the
 * temp files. Does not deduplicate or merge with any existing output.
 */
export function collectFromTempFiles(tempFiles: string[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const f of tempFiles) {
    if (existsSync(f)) {
      try {
        const loaded = JSON.parse(readFileSync(f, 'utf-8')) as unknown;
        if (Array.isArray(loaded)) results.push(...(loaded as Record<string, unknown>[]));
      } catch {
        /* ignore corrupt temp file */
      }
      rmSync(f, { force: true });
    }
  }
  return results;
}

/**
 * Reads each temp file, merges results with the existing final output (deduplicating
 * by eval_id|model|mode|tools), writes the merged array to finalOutputPath, and
 * deletes the temp files.
 */
export function mergeIntoOutput(tempFiles: string[], finalOutputPath: string): Record<string, unknown>[] {
  const key = (r: Record<string, unknown>) =>
    `${r.eval_id}|${r.model}|${r.mode}|${((r.tools as string[]) ?? []).join(',')}`;

  const fresh = collectFromTempFiles(tempFiles);

  const newKeys = new Set(fresh.map(key));
  let existing: Record<string, unknown>[] = [];
  if (existsSync(finalOutputPath)) {
    try {
      const loaded = JSON.parse(readFileSync(finalOutputPath, 'utf-8')) as unknown;
      if (Array.isArray(loaded)) {
        existing = (loaded as Record<string, unknown>[]).filter(
          (r) => typeof r === 'object' && r !== null && 'eval_id' in r && 'model' in r,
        );
      }
    } catch {
      /* ignore corrupt output file */
    }
  }

  const merged = [...existing.filter((r) => !newKeys.has(key(r))), ...fresh];
  writeFileSync(finalOutputPath, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}
