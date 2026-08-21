/**
 * Tests for the cross-run fold of the per-run recommendations, plus the report panel
 * that renders them.
 *
 * The point of the fold is ranking by repetition, so that is what these tests pin
 * down: the same finding across models outranks a one-off, a chatty run cannot
 * inflate its own count, and a failed analysis contributes nothing but is counted
 * separately so a caller does not read the result as complete when it is not. The
 * report itself renders findings only inside each run's own panel.
 */

import { describe, it, expect } from 'vitest';
import { aggregateRecommendations, countFailedAnalyses, renderHtml } from '../src/report.js';

function rec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: 'skill',
    severity: 'medium',
    issue: 'The MFA reference documents a flag the CLI does not have',
    suggestion: 'Replace the flag with the api call',
    context: 'feature-mfa/index.md',
    root_cause: 'skill',
    ...overrides,
  };
}

function result(
  model: string,
  recs: Record<string, unknown>[] | undefined,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eval_id: 'auth0_cli_mfa',
    model,
    mode: 'agent',
    status: 'success',
    grader_pass_rate: 0.8,
    cost_usd: 0.01,
    recommendations: recs ? { eval_id: 'auth0_cli_mfa', model, tools: ['skills'], recommendations: recs } : undefined,
    ...overrides,
  };
}

describe('aggregateRecommendations', () => {
  it('folds the same finding across runs into one row and counts the runs', () => {
    const issues = aggregateRecommendations([
      result('gpt-5.2', [rec()]),
      result('claude-sonnet-4-6', [rec()]),
      result('gemini-3-pro', [rec()]),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0].run_count).toBe(3);
    expect(issues[0].models).toEqual(['claude-sonnet-4-6', 'gemini-3-pro', 'gpt-5.2']);
    expect(issues[0].evals).toEqual(['auth0_cli_mfa']);
  });

  it('ranks a repeated finding above a higher-severity one-off', () => {
    // Repetition is evidence; a single high-severity finding is a hypothesis.
    const issues = aggregateRecommendations([
      result('gpt-5.2', [rec(), rec({ context: 'one-off', severity: 'high', issue: 'seen once' })]),
      result('claude-sonnet-4-6', [rec()]),
    ]);

    expect(issues[0].run_count).toBe(2);
    expect(issues[0].context).toBe('feature-mfa/index.md');
    expect(issues[1].context).toBe('one-off');
  });

  it('counts a run once even when it reports the same issue twice', () => {
    const issues = aggregateRecommendations([result('gpt-5.2', [rec(), rec({ issue: 'worded differently' })])]);

    expect(issues).toHaveLength(1);
    expect(issues[0].run_count).toBe(1);
    // Both wordings are kept — they are two descriptions of one problem.
    expect(issues[0].issues).toHaveLength(2);
  });

  it('groups contexts that differ only in punctuation or case', () => {
    const issues = aggregateRecommendations([
      result('gpt-5.2', [rec({ context: '`feature-mfa/index.md`' })]),
      result('claude-sonnet-4-6', [rec({ context: 'feature-mfa/index.md' })]),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0].run_count).toBe(2);
  });

  it('keeps different categories and root causes apart', () => {
    const issues = aggregateRecommendations([
      result('gpt-5.2', [rec(), rec({ category: 'grader', root_cause: 'grader' })]),
    ]);
    expect(issues).toHaveLength(2);
  });

  it('takes the highest severity any run reported', () => {
    const issues = aggregateRecommendations([
      result('gpt-5.2', [rec({ severity: 'low' })]),
      result('claude-sonnet-4-6', [rec({ severity: 'high' })]),
    ]);
    expect(issues[0].severity).toBe('high');
  });

  it('sorts by run count, then severity', () => {
    // Each finding needs its own wording, since wording is what identifies a finding.
    const low = rec({ context: 'a', severity: 'low', issue: 'The tenant settings section omits the audience' });
    const high = rec({ context: 'b', severity: 'high', issue: 'The callback example points at the wrong port' });
    const both = rec({
      context: 'c',
      severity: 'medium',
      issue: 'The invitation recipe passes an identifier as a name',
    });
    const issues = aggregateRecommendations([
      result('gpt-5.2', [low, high, both]),
      result('claude-sonnet-4-6', [both]),
    ]);
    expect(issues.map((i) => i.context)).toEqual(['c', 'b', 'a']);
  });

  it('ignores runs with no analysis and runs whose analysis failed', () => {
    const failed = result('gpt-5.2', undefined, {
      recommendations: {
        eval_id: 'auth0_cli_mfa',
        model: 'gpt-5.2',
        tools: [],
        recommendations: [],
        error: 'HTTP 500',
      },
    });
    expect(aggregateRecommendations([result('gpt-5.2', undefined), failed])).toEqual([]);
  });

  it('folds a finding whose wording carries no distinctive term', () => {
    // Nothing in "the flag is wrong" survives the term filter, and an empty signature
    // matches nothing — so without the whole-text fallback this reported twice.
    const terse = rec({ issue: 'the flag is wrong', context: '' });
    const issues = aggregateRecommendations([result('gpt-5.2', [terse]), result('claude-sonnet-4-6', [terse])]);
    expect(issues).toHaveLength(1);
    expect(issues[0].run_count).toBe(2);
  });

  it('returns an empty list for no results', () => {
    expect(aggregateRecommendations([])).toEqual([]);
  });
});

describe('countFailedAnalyses', () => {
  it('counts only results whose analysis carried an error', () => {
    const failed = result('gpt-5.2', undefined, {
      recommendations: {
        eval_id: 'auth0_cli_mfa',
        model: 'gpt-5.2',
        tools: [],
        recommendations: [],
        error: 'HTTP 500',
      },
    });
    expect(countFailedAnalyses([failed, result('claude-sonnet-4-6', [rec()]), result('gemini-3-pro', undefined)])).toBe(
      1,
    );
  });
});

describe('renderHtml — recommendations panel', () => {
  it('shows a run’s findings in that run’s own panel', () => {
    const html = renderHtml([result('gpt-5.2', [rec()]), result('claude-sonnet-4-6', [rec()])], '2024-01-01 00:00');
    const body = html.slice(html.indexOf('</style>'));
    expect(body).toContain('feature-mfa/index.md');
    expect(body).toContain('Replace the flag with the api call');
  });

  it('renders a finding once per run and nowhere else', () => {
    const html = renderHtml([result('gpt-5.2', [rec()]), result('claude-sonnet-4-6', [rec()])], '2024-01-01 00:00');
    const body = html.slice(html.indexOf('</style>'));
    expect(body.split('Replace the flag with the api call')).toHaveLength(3);
  });

  it('counts the findings by severity so the tab leads with how bad it is', () => {
    const html = renderHtml(
      [result('gpt-5.2', [rec({ severity: 'high' }), rec({ context: 'other', severity: 'low' })])],
      '2024-01-01 00:00',
    );
    const body = html.slice(html.indexOf('</style>'));
    expect(body).toContain('2 findings');
    expect(body).toContain('1 high');
    expect(body).toContain('1 low');
  });

  it('shows the reason on the run whose analysis failed instead of "no recommendations"', () => {
    // "No recommendations" and "the analysis crashed" must not look the same.
    const failed = result('gpt-5.2', undefined, {
      graders: [{ name: 'ran auth0 login', kind: 'event', passed: true, detail: 'ok' }],
      recommendations: {
        eval_id: 'auth0_cli_mfa',
        model: 'gpt-5.2',
        tools: ['skills'],
        recommendations: [],
        error: 'Failed to generate: HTTP 500 Internal Server Error',
      },
    });
    const body = renderHtml([failed], '2024-01-01 00:00').slice(0);
    expect(body).toContain('The analysis did not run');
    expect(body).toContain('HTTP 500 Internal Server Error');
  });
});
