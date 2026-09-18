/**
 * Proxy auth header resolution.
 *
 * The single place the configured auth header is composed. Every proxy call site
 * — the four agent runners, the baseline runner, and the LLM judge — reads this
 * rather than assembling a header itself, so the name/prefix/token rules live in
 * exactly one place.
 *
 * When `proxy.authHeader` is unset this returns `undefined` and callers fall back
 * to injecting `LLM_API_KEY` into the provider-native key var, which is the
 * framework's original behaviour.
 *
 * `LLM_API_KEY` takes precedence: when it is set, this returns `undefined` even
 * with `proxy.authHeader` configured. Existing deployments therefore keep working
 * untouched, and adopting the custom header is an explicit act — unset
 * `LLM_API_KEY` so the header path takes over.
 */

import { getFrameworkConfig } from './framework-config.js';
import { logger } from '../utils/logger.js';

/**
 * Provider-native API key env var. Declared here rather than imported from
 * `@a0/evals` — core cannot depend on the package that consumes it — and kept
 * in sync with `LLM_API_KEY_ENV` in `packages/evals/src/cli/constants.ts`.
 */
const LLM_API_KEY_ENV = 'LLM_API_KEY';

export interface ResolvedProxyAuth {
  /** Header name, verbatim from config. */
  name: string;
  /** Composed header value: `valuePrefix + token`. Secret — never log this. */
  value: string;
  /** Env var the token was read from. Used by the Codex runner, which passes an env-var name rather than a value. */
  tokenEnv: string;
}

/**
 * Inert value written to provider-native API-key vars (`ANTHROPIC_API_KEY`,
 * `GEMINI_API_KEY`, …) when an auth header is configured.
 *
 * It cannot simply be omitted: the Gemini CLI's `validateAuthMethod` rejects the
 * run unless `GEMINI_API_KEY` is non-empty, and the Claude binary requires one of
 * its credential vars to be present. Setting a placeholder satisfies those
 * validators while keeping the real token out of any provider-native header.
 * The text is self-describing so it reads as intentional if it ever surfaces in
 * a proxy error message.
 */
export const PLACEHOLDER_API_KEY = 'unused-see-proxy-auth-header';

/**
 * Resolves the configured proxy auth header, or `undefined` when none is
 * configured or its token env var is empty.
 *
 * A configured-but-empty token is treated as "not configured" and warns rather
 * than throwing — this function runs per-request, not once at startup, so it
 * cannot fail closed itself. The eval CLI's `validateApiKey()` (in
 * `packages/evals/src/cli/validators.ts`) is the actual fail-closed check: it
 * exits before any job starts when `proxy.authHeader` is configured but its
 * token env var is unset. This mirrors how `mintMcpToken` reports a failed mint.
 *
 * Returns `undefined` when `LLM_API_KEY` is set — see the module comment.
 */
export function resolveProxyAuthHeader(): ResolvedProxyAuth | undefined {
  const { authHeader } = getFrameworkConfig().proxy;
  if (!authHeader) return undefined;

  // The provider-native API key wins whenever it is present, even with
  // `proxy.authHeader` configured. A deployment that still exports
  // LLM_API_KEY keeps its existing behaviour untouched, so switching to the
  // custom header is an explicit act: unset LLM_API_KEY.
  if (process.env[LLM_API_KEY_ENV]) {
    logger.info(
      `[proxy-auth] ${LLM_API_KEY_ENV} is set — using the provider-native API key and ignoring proxy.authHeader.`,
    );
    return undefined;
  }

  const token = process.env[authHeader.tokenEnv];
  if (!token) {
    logger.warn(
      `[proxy-auth] proxy.authHeader is configured but ${authHeader.tokenEnv} is not set — ` +
        `falling back to the provider-native API key. Proxy requests will likely fail.`,
    );
    return undefined;
  }

  return {
    name: authHeader.name,
    value: `${authHeader.valuePrefix ?? ''}${token}`,
    tokenEnv: authHeader.tokenEnv,
  };
}
