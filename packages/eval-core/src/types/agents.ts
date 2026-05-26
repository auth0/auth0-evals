/**
 * Agent and trace type definitions shared across the eval framework.
 */

/** Agent runner types accepted by the `--agent-type` flag. */
export const KNOWN_AGENT_TYPES = ['claude-code', 'copilot', 'gemini-cli', 'codex'] as const;

/** Union of valid agent runner identifiers. */
export type AgentType = (typeof KNOWN_AGENT_TYPES)[number];

/** Error categories for tool call classification. */
export type ErrorCategory = 'not_found' | 'timeout' | 'syntax' | 'auth' | 'network' | 'permission' | 'unknown';

/** Serialised trace step for a single tool call. */
export interface TraceStep {
  step: number;
  actionType: string;
  tool: string;
  narrative: string;
  args: Record<string, unknown>;
  resultPreview: string;
  resultSizeBytes: number;
  resultLines: number;
  duration: number;
  causedError: boolean;
  isDocLookup: boolean;
  isInterruption: boolean;
  isRetry: boolean;
  recoveredFromError: boolean;
  errorCategory: ErrorCategory | undefined;
}

/** Per-turn token and latency metrics. */
export interface TurnMetricEntry {
  turn: number;
  input_tokens: number;
  output_tokens: number;
  llm_latency: number;
  finish_reason: string;
  tool_call_count: number;
  cost_usd: number;
}
