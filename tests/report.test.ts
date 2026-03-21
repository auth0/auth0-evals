/**
 * Happy path tests for src/report.ts
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadScores, renderHtml } from '../report.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(
  evalId = 'react_quickstart',
  model = 'gpt-5.2',
  mode = 'baseline',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eval_id: evalId,
    model,
    mode,
    status: 'success',
    grader_pass_rate: 1.0,
    cost_usd: 0.01,
    ...overrides,
  };
}

// ── renderHtml tests ──────────────────────────────────────────────────────────

describe('renderHtml', () => {
  it('returns non-empty string', () => {
    const html = renderHtml([makeResult()], '2024-01-01 00:00');
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains eval_id, model name, and generated_at', () => {
    const html = renderHtml([makeResult('react_quickstart', 'gpt-5.2')], '2024-01-01 12:34');
    expect(html).toContain('react_quickstart');
    expect(html).toContain('gpt-5.2');
    expect(html).toContain('2024-01-01 12:34');
  });

  it('renders numeric format strings (no raw %.Nf placeholders)', () => {
    const html = renderHtml([makeResult('react_quickstart', 'gpt-5.2', 'baseline', {
      cost_usd: 0.0123,
      wall_time: 4.5,
    })], '2024-01-01 00:00');
    expect(html).not.toContain('%.4f');
    expect(html).not.toContain('%.1f');
    expect(html).not.toContain('%.2f');
    expect(html).toContain('0.0123');
    expect(html).toContain('4.5');
  });

  it('includes all evals and models', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2'),
      makeResult('swift_quickstart', 'claude-4-6-sonnet'),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    expect(html).toContain('react_quickstart');
    expect(html).toContain('swift_quickstart');
    expect(html).toContain('gpt-5.2');
    expect(html).toContain('claude-4-6-sonnet');
  });
});

// ── loadScores + renderHtml integration ──────────────────────────────────────

describe('renderHtml from score files', () => {
  it('produces expected output from disk', () => {
    const tmpPath = mkdtempSync(join(tmpdir(), 'report_test_'));
    const scoresFile = join(tmpPath, 'scores-baseline.json');
    writeFileSync(scoresFile, JSON.stringify([makeResult('react_quickstart', 'gpt-5.2')]));

    const html = renderHtml(loadScores([scoresFile]), '2024-01-01 00:00');

    expect(html).toContain('react_quickstart');
    expect(html).toContain('gpt-5.2');
  });
});

// ── CSS class integration tests ───────────────────────────────────────────────

describe('renderHtml CSS class integration', () => {
  it('100% pass rate applies rate-excellent to card-score-value', () => {
    const html = renderHtml([makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 1.0 })], '2024-01-01 00:00');
    expect(html).toContain('class="card-score-value rate-excellent"');
  });

  it('50% pass rate (lower boundary of fair tier) applies rate-fair, not rate-poor', () => {
    const html = renderHtml([makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 0.5 })], '2024-01-01 00:00');
    expect(html).toContain('class="card-score-value rate-fair"');
    expect(html).not.toContain('class="card-score-value rate-poor"');
  });

  it('0% pass rate applies rate-poor to card-score-value', () => {
    const html = renderHtml([makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 0.0 })], '2024-01-01 00:00');
    expect(html).toContain('class="card-score-value rate-poor"');
  });

  it('overall grade A produces badge-a class on weighted-total badge', () => {
    const html = renderHtml([makeResult('react_quickstart', 'gpt-5.2', 'baseline', {
      overall_grade: 'A',
      overall_score: 95.0,
      dimensions: [{ name: 'friction', score: 95.0, weight: 0.15, grade: 'A' }],
    })], '2024-01-01 00:00');
    expect(html).toContain('class="badge badge-lg badge-a"');
  });

  it('overall grade F produces badge-df class (shared with D) on weighted-total badge', () => {
    const html = renderHtml([makeResult('react_quickstart', 'gpt-5.2', 'baseline', {
      overall_grade: 'F',
      overall_score: 20.0,
      dimensions: [{ name: 'friction', score: 20.0, weight: 0.15, grade: 'F' }],
    })], '2024-01-01 00:00');
    expect(html).toContain('class="badge badge-lg badge-df"');
  });
});
