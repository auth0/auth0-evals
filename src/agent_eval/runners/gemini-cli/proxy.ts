/**
 * ATKO LiteLLM proxy configuration for the Gemini CLI runner.
 *
 * Routes Gemini CLI requests through the internal ATKO LiteLLM proxy
 * (<LLM_PROXY_URL>) instead of the public Gemini API:
 *  - GOOGLE_GEMINI_BASE_URL redirects the Gemini CLI to the proxy
 *  - GEMINI_API_KEY must be the LiteLLM token, not a Google API key
 *
 * Set GEMINI_API_KEY in .env before running:
 *   GEMINI_API_KEY=$(ocm auth litellm)
 */

import { logger } from '../../../utils/logger.js';

const ATKO_LITELLM_BASE_URL = '<LLM_PROXY_URL>';

/**
 * Returns env var overrides that route the Gemini CLI through the ATKO
 * LiteLLM proxy. Reads GEMINI_API_KEY from the environment (.env).
 * Returns an empty object and logs a warning if the key is not set.
 */
export function geminiProxyEnv(): Record<string, string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn(
      '[GeminiProxy] GEMINI_API_KEY not set — Gemini CLI requests will fail.\n' +
        '  Add to .env: GEMINI_API_KEY=$(ocm auth litellm)',
    );
    return {};
  }

  logger.info('[GeminiProxy] Routing Gemini CLI through ATKO LiteLLM proxy.');
  return {
    GOOGLE_GEMINI_BASE_URL: ATKO_LITELLM_BASE_URL,
    GEMINI_API_KEY: apiKey,
  };
}
