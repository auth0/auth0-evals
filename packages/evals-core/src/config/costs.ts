import { logger } from '../utils/logger.js';

// [input, output, cachedInput?] USD per 1M tokens (cachedInput defaults to the input price), grouped by series with the newest version first.
// TODO: fill in the [0.0, 0.0] placeholders before merging — 0 reports those models as free.
export const COST_TABLE: Record<string, [number, number, number?]> = {
  // GPT sol
  'gpt-6.1-sol': [2.0, 10.0],
  'gpt-5.6-sol': [5.0, 30.0],

  // GPT luna
  'gpt-6-luna': [0.1, 0.5],
  'gpt-5.6-luna': [1.0, 6.0],

  // GPT terra
  'gpt-6.1-terra': [1.0, 5.0],
  'gpt-5.6-terra': [2.5, 15.0],

  // Claude Opus
  'claude-opus-5-5': [4.0, 20.0],
  'claude-opus-5': [5.0, 25.0],

  // Claude Sonnet
  'claude-sonnet-5-5': [2.0, 10.0],
  'claude-sonnet-5': [2.0, 10.0],

  // Claude Haiku
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-haiku-4-5': [1.0, 5.0],

  // Gemini Pro
  'gemini-3.1-pro-preview': [2.0, 12.0, 0.2],

  // Gemini Flash
  'gemini-3.8-flash': [0.75, 3.75, 0.075],
};

/** [input, output] USD per million tokens applied to models absent from COST_TABLE. */
export const DEFAULT_PRICING: [number, number] = [1.0, 5.0];

// Models already warned about, so the fallback-pricing notice fires once per model.
const warnedUnknownModels = new Set<string>();

/** inputTokens is the total prompt size; cachedTokens is the cached subset of it. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const pricing = COST_TABLE[model];
  if (!pricing && !warnedUnknownModels.has(model)) {
    warnedUnknownModels.add(model);
    logger.warn(
      `[cost] No pricing for model '${model}'; using default $${DEFAULT_PRICING[0]}/$${DEFAULT_PRICING[1]} per 1M tokens. ` +
        `Add it to COST_TABLE for accurate cost estimates.`,
    );
  }
  const [inPrice, outPrice, cachedPrice = inPrice] = pricing ?? DEFAULT_PRICING;
  return ((inputTokens - cachedTokens) * inPrice + cachedTokens * cachedPrice + outputTokens * outPrice) / 1_000_000;
}
