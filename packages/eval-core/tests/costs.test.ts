/**
 * Tests for src/config/costs.ts — estimateCost pricing and unknown-model warning.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { estimateCost, COST_TABLE, DEFAULT_PRICING } from '../src/config/costs.js';
import { setLogger } from '../src/utils/logger.js';
import type { Logger } from '../src/utils/logger.js';

const warnings: string[] = [];
const captureLogger: Logger = {
  info: () => {},
  warn: (...args) => warnings.push(args.map(String).join(' ')),
  error: () => {},
};

beforeEach(() => {
  warnings.length = 0;
  setLogger(captureLogger);
});

describe('estimateCost', () => {
  it('computes cost from the model pricing in COST_TABLE', () => {
    const [inPrice, outPrice] = COST_TABLE['gpt-5.4']!;
    const cost = estimateCost('gpt-5.4', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(inPrice + outPrice, 6);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCost('gpt-5.4', 0, 0)).toBe(0);
  });

  it('applies DEFAULT_PRICING and warns once for an unknown model', () => {
    const model = 'totally-made-up-model-xyz';
    const cost = estimateCost(model, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(DEFAULT_PRICING[0] + DEFAULT_PRICING[1], 6);
    expect(warnings.some((w) => w.includes(model))).toBe(true);

    // A second call for the same model must not warn again.
    warnings.length = 0;
    estimateCost(model, 10, 10);
    expect(warnings).toHaveLength(0);
  });
});
