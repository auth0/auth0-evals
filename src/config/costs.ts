export const COST_TABLE: Record<string, [number, number]> = {
  'gpt-5.2': [1.75, 14.0],
  'claude-4-6-sonnet': [3.0, 15.0],
  'claude-4-6-opus': [5.0, 25.0],
  'gemini-3-pro-preview': [2.0, 12.0],
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const [inPrice, outPrice] = COST_TABLE[model] ?? [1.0, 5.0];
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}
