/** Common across all platforms. */
const COMMON_KEYS = ['PATH', 'HOME', 'LANG', 'TERM', 'NODE_OPTIONS'];

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
  return env;
}
