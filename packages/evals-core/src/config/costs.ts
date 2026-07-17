import { logger } from '../utils/logger.js';

export const COST_TABLE: Record<string, [number, number]> = {
  'gpt-5.6-sol': [5.0, 30.0],
  'gpt-5.6-luna': [1.0, 6.0],
  'gpt-5.6-terra': [2.5, 15.0],
  'claude-sonnet-5': [2.0, 10.0],
  'claude-opus-4-8': [5.0, 25.0],
  'claude-haiku-4-5': [1.0, 5.0],
  'gemini-3.1-pro-preview': [2.0, 12.0],
  'gemini-3.5-flash': [1.5, 9.0],
};

/** [input, output] USD per million tokens applied to models absent from COST_TABLE. */
export const DEFAULT_PRICING: [number, number] = [1.0, 5.0];

// Models already warned about, so the fallback-pricing notice fires once per model.
const warnedUnknownModels = new Set<string>();

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = COST_TABLE[model];
  if (!pricing && !warnedUnknownModels.has(model)) {
    warnedUnknownModels.add(model);
    logger.warn(
      `[cost] No pricing for model '${model}'; using default $${DEFAULT_PRICING[0]}/$${DEFAULT_PRICING[1]} per 1M tokens. ` +
        `Add it to COST_TABLE for accurate cost estimates.`,
    );
  }
  const [inPrice, outPrice] = pricing ?? DEFAULT_PRICING;
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}
