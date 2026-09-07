/**
 * Pure validation and default-resolution functions for CLI arguments.
 *
 * Each function validates a single CLI option and returns the resolved value,
 * or calls `process.exit(1)` on invalid input.
 */

import { logger, getFrameworkConfig } from '@a0/evals-core';
import {
  ALL_MODES,
  KNOWN_TOOLS,
  KNOWN_WORKING_MODELS,
  DEFAULT_MODEL,
  KNOWN_AGENT_TYPES,
  LLM_API_KEY_ENV,
  parseToolsArg,
  type Mode,
  type AgentType,
} from './constants.js';

/** Valid meta-values accepted by `--mode` in addition to the concrete Mode values. */
const META_MODES = ['all'] as const;

/**
 * The configured proxy auth header's token env var name, or `undefined` when no
 * `proxy.authHeader` is configured. Tolerates an uninitialised config singleton —
 * `validateApiKey` is called from unit tests that never load a framework config,
 * and an absent config simply means "no auth header".
 */
function proxyAuthHeaderTokenEnv(): string | undefined {
  try {
    return getFrameworkConfig().proxy.authHeader?.tokenEnv;
  } catch {
    return undefined;
  }
}

/**
 * Reads and validates the LLM API key from the environment.
 *
 * Exits if missing, unless `proxy.authHeader` is configured — that deployment
 * authenticates via the custom header instead, so requiring the provider-native
 * key would make the header path unreachable. In that case also exits if the
 * header's own token env var is unset: an empty token is a misconfiguration
 * (typo'd env var name), and failing here — before any job starts — surfaces it
 * immediately instead of every job failing later on an opaque 401 from the proxy.
 * Returns an empty string when the header path is validated; call sites route
 * the credential through the header and write `PLACEHOLDER_API_KEY` into
 * provider-native key fields.
 */
export function validateApiKey(): string {
  const apiKey = process.env[LLM_API_KEY_ENV];
  if (apiKey) return apiKey;

  const tokenEnv = proxyAuthHeaderTokenEnv();
  if (tokenEnv === undefined) {
    logger.error(`Error: ${LLM_API_KEY_ENV} environment variable not set.`);
    process.exit(1);
  }
  if (!process.env[tokenEnv]) {
    logger.error(
      `Error: ${LLM_API_KEY_ENV} is not set and proxy.authHeader is configured but its token env var ` +
        `${tokenEnv} is also not set. No credential is available for either path.`,
    );
    process.exit(1);
  }
  return '';
}

/**
 * Resolves and validates the model list.
 *
 * `--model all` expands to `knownModels` — the app's configured `models.known`
 * when provided (and non-empty), otherwise the framework's `KNOWN_WORKING_MODELS`
 * fallback. This lets an app narrow the `all` set (e.g. drop deprecated models)
 * via `eval.config.js` without changing framework code.
 *
 * When `--model` is omitted entirely, falls back to `defaultModel` — the app's
 * configured `models.default` — when provided (and non-empty), otherwise the
 * framework's `DEFAULT_MODEL` constant.
 */
export function validateModels(rawModels: string[], knownModels?: string[], defaultModel?: string): string[] {
  const allModels = knownModels && knownModels.length > 0 ? knownModels : KNOWN_WORKING_MODELS;
  if (rawModels.length > 0 && rawModels.includes('all')) {
    logger.info(`Using all known working models: ${allModels.join(', ')}`);
    return allModels;
  }
  if (rawModels.length > 0) {
    return rawModels;
  }
  return [defaultModel && defaultModel.length > 0 ? defaultModel : DEFAULT_MODEL];
}

/**
 * Resolves and validates the execution mode(s).
 * Handles meta-values (`all`) and deprecated formats (`agent+skills`).
 */
export function validateModes(modeArg: string | undefined): Mode[] {
  if (modeArg == null) {
    return ['baseline'];
  }
  if (modeArg === 'all') {
    logger.info(`Running all modes: ${ALL_MODES.join(', ')}`);
    return ALL_MODES;
  }
  if (!ALL_MODES.includes(modeArg as Mode)) {
    if (modeArg === 'agent+skills') {
      logger.error(`'agent+skills' mode has been replaced. Use: --mode agent --tools skills`);
    } else {
      const validValues = [...ALL_MODES, ...META_MODES].join(', ');
      logger.error(`Invalid mode: ${modeArg}. Choose from: ${validValues}`);
    }
    process.exit(1);
  }
  return [modeArg as Mode];
}

/**
 * Validates that all requested eval IDs exist in the provided known eval IDs list.
 *
 * @param evalIds - IDs provided by the user via `--eval`.
 * @param knownEvalIds - All registered eval IDs from the eval registry.
 */
export function validateEvalIds(evalIds: string[], knownEvalIds: string[]): string[] {
  if (evalIds.length > 0) {
    const unknown = evalIds.filter((id) => !knownEvalIds.includes(id));
    if (unknown.length > 0) {
      logger.error(`Unknown eval(s): ${unknown.join(', ')}`);
      process.exit(1);
    }
  }
  return evalIds;
}

/** Parses the `--tools` flag and validates all tool names against KNOWN_TOOLS. */
export function validateTools(toolsArg: string): string[] {
  const tools = parseToolsArg(toolsArg);
  const unknownTools = tools.filter((t) => !KNOWN_TOOLS.some((k) => k.toLowerCase() === t.toLowerCase()));
  if (unknownTools.length > 0) {
    logger.error(`Unknown tool(s): ${unknownTools.join(', ')}. Known tools: ${KNOWN_TOOLS.join(', ')}`);
    process.exit(1);
  }
  return tools;
}

/** Parses and validates the `--workers` count. Defaults to 4. */
export function validateWorkers(raw: string | undefined): number {
  const workers = parseInt(raw ?? '4', 10);
  if (!Number.isInteger(workers) || workers < 1) {
    logger.error(`Invalid --workers value: ${JSON.stringify(raw)}. Must be a positive integer.`);
    process.exit(1);
  }
  return workers;
}

/** Validates the `--agent-type` flag against KNOWN_AGENT_TYPES. */
export function validateAgentType(agentType: string | undefined): AgentType | undefined {
  if (agentType !== undefined && !(KNOWN_AGENT_TYPES as readonly string[]).includes(agentType)) {
    logger.error(`Invalid --agent-type: ${agentType}. Choose from: ${KNOWN_AGENT_TYPES.join(', ')}`);
    process.exit(1);
  }
  return agentType as AgentType | undefined;
}
