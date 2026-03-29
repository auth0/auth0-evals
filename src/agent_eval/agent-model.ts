/**
 * Model detection utilities.
 */

import { BEDROCK_MODELS, GEMINI_MODELS } from '../config/settings.js';

/**
 * Checks if the given model name corresponds to a Bedrock model by looking for known Bedrock model name patterns.
 * @param model The name of the model to check.
 * @returns True if the model name includes any of the known Bedrock model substrings, false otherwise.
 */
export function isBedrockModel(model: string): boolean {
  return BEDROCK_MODELS.some((prefix) => model.includes(prefix));
}

/**
 * Checks if the given model name corresponds to a Gemini model by looking for known Gemini model name patterns.
 * @param model The name of the model to check.
 * @returns True if the model name starts with any of the known Gemini model prefixes, false otherwise.
 */
export function isGeminiModel(model: string): boolean {
  return GEMINI_MODELS.some((prefix) => model.startsWith(prefix));
}
