/**
 * Pure validation and default-resolution functions for CLI arguments.
 *
 * Each function validates a single CLI option and returns the resolved value,
 * or calls `process.exit(1)` on invalid input.
 */

import { logger } from '@a0/eval-core';
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

/** Reads and validates the LLM API key from the environment. Exits if missing. */
export function validateApiKey(): string {
  const apiKey = process.env[LLM_API_KEY_ENV];
  if (!apiKey) {
    logger.error(`Error: ${LLM_API_KEY_ENV} environment variable not set.`);
    process.exit(1);
  }
  return apiKey;
}

/**
 * Resolves and validates the model list.
 * `--model all` expands to all known models; `--matrix` without explicit models does the same.
 */
export function validateModels(rawModels: string[], matrix: boolean): string[] {
  if (rawModels.length > 0 && rawModels.includes('all')) {
    logger.info(`Using all known working models: ${KNOWN_WORKING_MODELS.join(', ')}`);
    return KNOWN_WORKING_MODELS;
  }
  if (rawModels.length > 0) {
    return rawModels;
  }
  if (matrix) {
    logger.info(`Using all known working models: ${KNOWN_WORKING_MODELS.join(', ')}`);
    return KNOWN_WORKING_MODELS;
  }
  return [DEFAULT_MODEL];
}

/**
 * Resolves and validates the execution mode(s).
 * Handles meta-values (`all`) and deprecated formats (`matrix`, `agent+skills`).
 */
export function validateModes(modeArg: string | undefined, matrix: boolean): Mode[] {
  if (modeArg == null) {
    return matrix ? ALL_MODES : ['baseline'];
  }
  if (modeArg === 'all') {
    logger.info(`Running all modes: ${ALL_MODES.join(', ')}`);
    return ALL_MODES;
  }
  if (modeArg === 'matrix') {
    logger.error(`'--mode matrix' has been replaced. Use the standalone --matrix flag instead.`);
    process.exit(1);
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

/** Parses and validates the `--workers` count. Defaults to 20 in matrix mode, 4 otherwise. */
export function validateWorkers(raw: string | undefined, matrix: boolean): number {
  const workers = parseInt(raw ?? (matrix ? '20' : '4'), 10);
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
