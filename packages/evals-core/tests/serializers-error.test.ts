import { describe, it, expect } from 'vitest';
import { serialiseError } from '../src/serializers.js';
import { REDACTION_MARKER } from '../src/utils/redact.js';

describe('serialiseError', () => {
  it('returns an ErrorJobResult with all zero metrics', () => {
    const result = serialiseError('react_quickstart', 'quickstarts', 'gpt-5.4', 'agent', ['mcp'], 'timeout');

    expect(result).toEqual({
      eval_id: 'react_quickstart',
      model: 'gpt-5.4',
      mode: 'agent',
      tools: ['mcp'],
      category: 'quickstarts',
      status: 'error',
      error: 'timeout',
      wall_time: 0,
      tokens: 0,
      cost_usd: 0,
      judge_cost_usd: 0,
      total_cost_usd: 0,
    });
  });

  it('redacts a credential carried in the error text', () => {
    // An exception thrown mid-request is one of the few places a credential travels
    // as prose rather than as a keyed value, and this field is published verbatim.
    const result = serialiseError(
      'react_quickstart',
      'quickstarts',
      'gpt-5.4',
      'agent',
      [],
      'Request failed: Authorization: Bearer fixture_not_a_real_secret_9f8e7d6c5b4a',
    );

    expect(result.error).not.toContain('fixture_not_a_real_secret_9f8e7d6c5b4a');
    // The surrounding diagnosis survives — a reader still sees which call failed and how.
    expect(result.error).toBe(`Request failed: Authorization: Bearer ${REDACTION_MARKER}`);
  });
});
