import { describe, it, expect } from 'vitest';
import { serialiseError } from '../src/serializers.js';

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
});
