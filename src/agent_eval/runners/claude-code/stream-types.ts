/**
 * TypeScript types for the Claude Code CLI stream-json event protocol.
 *
 * These map 1:1 to the JSONL event shapes emitted by `claude --output-format stream-json`.
 */

export interface CcSystemEvent {
  type: 'system';
  subtype: string;
  session_id: string;
  model: string;
  cwd: string;
}

export interface CcContentText {
  type: 'text';
  text: string;
}

export interface CcContentToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CcAssistantEvent {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: (CcContentText | CcContentToolUse)[];
    model: string;
    stop_reason: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface CcToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | { type: string; text: string }[];
  is_error?: boolean;
}

// Tool results arrive as user-turn events (matches the Anthropic Messages API shape)
export interface CcUserEvent {
  type: 'user';
  message: {
    role: 'user';
    content: CcToolResultContent[];
  };
}

export interface CcResultEvent {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  is_error: boolean;
  result: string;
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  num_turns: number;
  usage: { input_tokens: number; output_tokens: number };
}

export type CcEvent = CcSystemEvent | CcAssistantEvent | CcUserEvent | CcResultEvent | { type: string };
