/**
 * Resolves the raw runtime frontmatter (serve_command, serve_port, runtime_swap)
 * plus process env into a structured runtime config — or reports what is missing.
 *
 * Pure function: takes an explicit env map so it is trivially testable.
 */

import type { RuntimeTestUser } from '@a0/eval-graders';

export interface RuntimeConfig {
  serveCommand: string;
  servePort: number;
  swap: Array<{ from: string; to: string }>;
  testUser: RuntimeTestUser;
}

export interface RuntimeFrontmatter {
  serveCommand?: string;
  servePort?: number;
  runtimeSwap?: string;
}

export type ResolveResult =
  | { ok: true; config: RuntimeConfig }
  | { ok: false; missing: string[] };

const TEST_USER_VARS = {
  email: 'RUNTIME_TEST_USER_EMAIL',
  password: 'RUNTIME_TEST_USER_PASSWORD',
  expectedName: 'RUNTIME_TEST_USER_NAME',
} as const;

/**
 * Parses a `runtime_swap` string ("fake=$VAR, fake2=$VAR2") into from/to pairs,
 * resolving each `$VAR` against env. Returns the resolved pairs plus the names
 * of any env vars that were referenced but not set.
 */
function parseSwap(
  raw: string | undefined,
  env: Record<string, string | undefined>,
): { pairs: Array<{ from: string; to: string }>; missing: string[] } {
  const pairs: Array<{ from: string; to: string }> = [];
  const missing: string[] = [];
  if (!raw) return { pairs, missing };

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const from = trimmed.slice(0, eq).trim();
    const rhs = trimmed.slice(eq + 1).trim();
    const varName = rhs.startsWith('$') ? rhs.slice(1) : rhs;
    const value = env[varName];
    if (value === undefined || value === '') {
      missing.push(varName);
      continue;
    }
    pairs.push({ from, to: value });
  }
  return { pairs, missing };
}

export function resolveRuntimeConfig(
  fm: RuntimeFrontmatter,
  env: Record<string, string | undefined>,
): ResolveResult {
  const missing: string[] = [];

  if (!fm.serveCommand) missing.push('serve_command');
  if (!fm.servePort) missing.push('serve_port');

  const { pairs, missing: swapMissing } = parseSwap(fm.runtimeSwap, env);
  missing.push(...swapMissing);

  const testUser: RuntimeTestUser = { email: '', password: '', expectedName: '' };
  for (const [key, varName] of Object.entries(TEST_USER_VARS)) {
    const value = env[varName];
    if (value === undefined || value === '') {
      missing.push(varName);
    } else {
      testUser[key as keyof RuntimeTestUser] = value;
    }
  }

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      serveCommand: fm.serveCommand!,
      servePort: fm.servePort!,
      swap: pairs,
      testUser,
    },
  };
}
