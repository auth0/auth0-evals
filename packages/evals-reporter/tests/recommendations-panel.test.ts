/**
 * Tests for the report panel that renders per-run recommendations.
 *
 * The report renders findings only inside each run's own panel: a run's findings
 * show up once in that run, the tab leads with how bad the findings are, and a run
 * whose analysis failed shows the reason instead of looking like it had nothing to say.
 */

import { describe, it, expect } from 'vitest';
import { renderHtml } from '../src/report.js';

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
