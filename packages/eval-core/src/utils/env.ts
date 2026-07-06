import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';

/** Common across all platforms. */
const COMMON_KEYS = ['PATH', 'HOME', 'LANG', 'TERM', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'];

/** macOS / Linux — TMPDIR is the standard temp-dir variable on Darwin. */
const POSIX_KEYS = ['TMPDIR', 'USER', 'SHELL'];

/** Windows — required for child processes / Node.js to function correctly. */
const WIN32_KEYS = ['USERPROFILE', 'SYSTEMROOT', 'TEMP', 'TMP', 'COMSPEC'];

/**
 * Returns a filtered copy of `process.env` containing only system-essential
 * variables.  Runner-specific variables (API keys, proxy URLs, etc.) should be
 * merged explicitly by each call-site so secrets are never leaked to child
 * processes by accident.
 */
export function filteredEnv(): Record<string, string> {
  const platformKeys = process.platform === 'win32' ? WIN32_KEYS : POSIX_KEYS;
  const ALLOWED_KEYS = [...COMMON_KEYS, ...platformKeys];

  // Build a case-insensitive lookup from the actual process.env keys.
  // On Windows, env var names like Path, ComSpec, SystemRoot are common
  // mixed-case variants; this ensures we find them regardless of casing.
  const envKeysLower = new Map<string, string>();
  for (const key of Object.keys(process.env)) {
    envKeysLower.set(key.toLowerCase(), key);
  }

  const env: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    const actualKey = envKeysLower.get(key.toLowerCase()) ?? key;
    if (process.env[actualKey] !== undefined) {
      env[actualKey] = process.env[actualKey]!;
    }
  }

  // Agent runs are categorically non-interactive. Forcing CI makes child
  // tooling (npx, Nuxt telemetry, etc.) skip consent/install prompts that
  // would otherwise hang the agent loop until the command times out.
  env.CI = '1';

  // Mock CLI shims. When EVAL_MOCK_BIN_DIR points at an existing directory,
  // prepend it to PATH so stubbed external CLIs (e.g. `auth0`) resolve to the
  // hermetic no-op stubs in mocks/ instead of a real binary. Prepending
  // (not appending) guarantees a real install on the host can never be hit —
  // keeping runs deterministic and preventing accidental live side effects.
  // Both execution paths set this: entrypoint.sh in the sandbox, run.ts locally.
  const mockBinDir = process.env.EVAL_MOCK_BIN_DIR;
  if (mockBinDir && existsSync(mockBinDir)) {
    env.PATH = env.PATH ? `${mockBinDir}${delimiter}${env.PATH}` : mockBinDir;
  }

  // Mock CLI state. Stateful stubs (e.g. mocks/auth0) persist per-run state
  // here so a `get` reflects a prior `put`. Lives outside the workspace so it
  // is never graded. Forwarded verbatim; the stub falls back to a temp dir if
  // unset. Both execution paths set this: entrypoint.sh in the sandbox,
  // run.ts locally.
  const mockStateDir = process.env.EVAL_MOCK_STATE_DIR;
  if (mockStateDir) {
    env.EVAL_MOCK_STATE_DIR = mockStateDir;
  }

  return env;
}
