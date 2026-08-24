import { describe, it, expect } from 'vitest';
import { axisTranscriptToToolCalls } from '../src/adapter.js';
import type { TranscriptEntry } from '@netlify/axis';

describe('axisTranscriptToToolCalls', () => {
  it('returns empty array for empty transcript', () => {
    expect(axisTranscriptToToolCalls([])).toEqual([]);
  });

  it('returns empty array when transcript has no tool calls', () => {
    const transcript: TranscriptEntry[] = [
      { type: 'assistant', timestamp: '2024-01-01T00:00:00Z', content: { text: 'Hello' } },
      { type: 'user', timestamp: '2024-01-01T00:00:01Z', content: { text: 'Hi' } },
    ];
    expect(axisTranscriptToToolCalls(transcript)).toEqual([]);
  });

  it('converts a matched tool_use + tool_result pair', () => {
    const transcript: TranscriptEntry[] = [
      {
        type: 'tool_use',
        timestamp: '2024-01-01T00:00:00Z',
        content: { id: 'call_1', name: 'read_file', input: { path: 'src/app.ts' } },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:01Z',
        content: { tool_use_id: 'call_1', content: 'import React from "react";', is_error: false },
      },
    ];

    const result = axisTranscriptToToolCalls(transcript);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'read_file',
      args: { path: 'src/app.ts' },
      result: 'import React from "react";',
      causedError: false,
    });
  });

  it('defaults causedError to false when is_error is absent', () => {
    const transcript: TranscriptEntry[] = [
      {
        type: 'tool_use',
        timestamp: '2024-01-01T00:00:00Z',
        content: { id: 'call_1', name: 'write_file', input: {} },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:01Z',
        content: { tool_use_id: 'call_1', content: 'ok' },
      },
    ];

    expect(axisTranscriptToToolCalls(transcript)[0].causedError).toBe(false);
  });

  it('marks causedError true when is_error is set', () => {
    const transcript: TranscriptEntry[] = [
      {
        type: 'tool_use',
        timestamp: '2024-01-01T00:00:00Z',
        content: { id: 'call_2', name: 'run_command', input: { command: 'npm install' } },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:01Z',
        content: { tool_use_id: 'call_2', content: 'ENOENT: no such file', is_error: true },
      },
    ];

    expect(axisTranscriptToToolCalls(transcript)[0].causedError).toBe(true);
  });

  it('skips tool_result entries with no matching tool_use', () => {
    const transcript: TranscriptEntry[] = [
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:00Z',
        content: { tool_use_id: 'unknown_id', content: 'some output' },
      },
    ];

    expect(axisTranscriptToToolCalls(transcript)).toEqual([]);
  });

  it('skips tool_use entries missing id or name', () => {
    const transcript: TranscriptEntry[] = [
      {
        type: 'tool_use',
        timestamp: '2024-01-01T00:00:00Z',
        content: { name: 'read_file', input: {} }, // missing id
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:01Z',
        content: { tool_use_id: undefined, content: 'result' },
      },
    ];

    expect(axisTranscriptToToolCalls(transcript)).toEqual([]);
  });

  it('serialises non-string tool result content to JSON', () => {
    const transcript: TranscriptEntry[] = [
      {
        type: 'tool_use',
        timestamp: '2024-01-01T00:00:00Z',
        content: { id: 'call_3', name: 'list_files', input: {} },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:01Z',
        content: { tool_use_id: 'call_3', content: ['a.ts', 'b.ts'] },
      },
    ];

    expect(axisTranscriptToToolCalls(transcript)[0].result).toBe('["a.ts","b.ts"]');
  });

  it('produces empty string result when content is absent', () => {
    const transcript: TranscriptEntry[] = [
      {
        type: 'tool_use',
        timestamp: '2024-01-01T00:00:00Z',
        content: { id: 'call_4', name: 'think', input: {} },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:01Z',
        content: { tool_use_id: 'call_4' }, // no content field
      },
    ];

    expect(axisTranscriptToToolCalls(transcript)[0].result).toBe('');
  });

  it('handles multiple tool calls preserving result order', () => {
    const transcript: TranscriptEntry[] = [
      {
        type: 'tool_use',
        timestamp: '2024-01-01T00:00:00Z',
        content: { id: 'a', name: 'tool_a', input: { x: 1 } },
      },
      {
        type: 'tool_use',
        timestamp: '2024-01-01T00:00:01Z',
        content: { id: 'b', name: 'tool_b', input: { x: 2 } },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:02Z',
        content: { tool_use_id: 'a', content: 'result_a' },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:03Z',
        content: { tool_use_id: 'b', content: 'result_b' },
      },
    ];

    const results = axisTranscriptToToolCalls(transcript);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: 'tool_a', result: 'result_a' });
    expect(results[1]).toMatchObject({ name: 'tool_b', result: 'result_b' });
  });
});
