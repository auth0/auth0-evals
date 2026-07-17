/**
 * Model detection utilities.
 *
 * Determines which provider/routing a model belongs to based on known prefixes.
 */

import { BEDROCK_MODELS, GEMINI_MODELS, GPT_MODELS } from './settings.js';

/**
 * Checks if the given model name corresponds to a Bedrock model by looking for known Bedrock model name prefixes.
 */
export function isBedrockModel(model: string): boolean {
  return BEDROCK_MODELS.some((prefix) => model.startsWith(prefix));
}

/**
 * Checks if the given model name corresponds to a Claude model.
 * Claude models are also Bedrock models — this is an alias for readability.
 */
export function isClaudeModel(model: string): boolean {
  return isBedrockModel(model);
}

/**
 * Checks if the given model name corresponds to a Gemini model by looking for known Gemini model name patterns.
 */
export function isGeminiModel(model: string): boolean {
  return GEMINI_MODELS.some((prefix) => model.startsWith(prefix));
}

/**
 * Checks if the given model name corresponds to a GPT model routed through the Copilot SDK.
 */
export function isGptModel(model: string): boolean {
  return GPT_MODELS.some((prefix) => model.startsWith(prefix));
}
