/**
 * AXIS transcript adapter.
 *
 * Converts an AXIS TranscriptEntry[] to the EventToolCall[] format the
 * auth0-evals grader engine expects.
 *
 * AXIS represents tool interactions as paired entries:
 *   - tool_use:    carries the tool name and input arguments
 *   - tool_result: carries the output and error flag
 *
 * We join pairs by tool ID and produce one EventToolCall per pair.
 */

import type { TranscriptEntry } from '@netlify/axis';
import type { EventToolCall } from '@a0/evals-graders';

export function axisTranscriptToToolCalls(transcript: TranscriptEntry[]): EventToolCall[] {
  // First pass: index tool_use entries by their ID.
  const toolUseById = new Map<string, { name: string; args: Record<string, unknown> }>();

  for (const entry of transcript) {
    if (entry.type !== 'tool_use') continue;
    const c = entry.content as Record<string, unknown>;
    const id = c['id'] as string | undefined;
    const name = c['name'] as string | undefined;
    if (!id || !name) continue;
    toolUseById.set(id, {
      name,
      args: (c['input'] as Record<string, unknown> | undefined) ?? {},
    });
  }

  // Second pass: emit EventToolCall for each tool_result paired with a tool_use.
  const toolCalls: EventToolCall[] = [];

  for (const entry of transcript) {
    if (entry.type !== 'tool_result') continue;
    const c = entry.content as Record<string, unknown>;
    const toolUseId = c['tool_use_id'] as string | undefined;
    if (!toolUseId) continue;

    const toolUse = toolUseById.get(toolUseId);
    if (!toolUse) continue;

    const isError = (c['is_error'] as boolean | undefined) ?? false;
    const contentVal = c['content'];
    const result = typeof contentVal === 'string' ? contentVal : contentVal != null ? JSON.stringify(contentVal) : '';

    toolCalls.push({
      name: toolUse.name,
      args: toolUse.args,
      result,
      causedError: isError,
    });
  }

  return toolCalls;
}
