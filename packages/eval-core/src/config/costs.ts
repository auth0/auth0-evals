export const COST_TABLE: Record<string, [number, number]> = {
  'gpt-5.4': [2.5, 15.0],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-4.1': [2.0, 8.0],
  'claude-sonnet-4-5': [3.0, 15.0],
  'claude-sonnet-4-6': [3.0, 15.0],
  'claude-opus-4-6': [5.0, 25.0],
  'claude-opus-4-7': [5.0, 25.0],
  'claude-haiku-4-5': [1.0, 5.0],
  'gemini-3.1-pro-preview': [2.0, 12.0],
  'gemini-3.1-flash-lite-preview': [0.25, 1.5],
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const [inPrice, outPrice] = COST_TABLE[model] ?? [1.0, 5.0];
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}
