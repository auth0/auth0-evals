// TODO: prices below are approximate and have not been verified.
// Review before using cost figures for any reporting or budgeting.
export const COST_TABLE: Record<string, [number, number]> = {
  'gpt-5.2': [10.0, 30.0],
  'claude-4-6-sonnet': [3.0, 15.0],
  'claude-4-6-opus': [15.0, 75.0],
  'gemini-3-pro-preview': [2.0, 10.0],
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const [inPrice, outPrice] = COST_TABLE[model] ?? [1.0, 5.0];
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}
