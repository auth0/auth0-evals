/**
 * Happy path tests for src/report.ts
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadScores, renderHtml, groupByVariant, computeDeltas, resultVariant } from '../src/report.js';

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
    const html = renderHtml(
      [
        makeResult('react_quickstart', 'gpt-5.2', 'baseline', {
          cost_usd: 0.0123,
          wall_time: 4.5,
        }),
      ],
      '2024-01-01 00:00',
    );
    expect(html).not.toContain('%.4f');
    expect(html).not.toContain('%.1f');
    expect(html).not.toContain('%.2f');
    expect(html).toContain('0.0123');
    expect(html).toContain('4.5');
  });

  it('includes all evals and models', () => {
    const results = [makeResult('react_quickstart', 'gpt-5.2'), makeResult('swift_quickstart', 'claude-4-6-sonnet')];
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
    const html = renderHtml(
      [makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 1.0 })],
      '2024-01-01 00:00',
    );
    expect(html).toContain('class="card-score-value rate-excellent"');
  });

  it('50% pass rate (lower boundary of fair tier) applies rate-fair, not rate-poor', () => {
    const html = renderHtml(
      [makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 0.5 })],
      '2024-01-01 00:00',
    );
    expect(html).toContain('class="card-score-value rate-fair"');
    expect(html).not.toContain('class="card-score-value rate-poor"');
  });

  it('0% pass rate applies rate-poor to card-score-value', () => {
    const html = renderHtml(
      [makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 0.0 })],
      '2024-01-01 00:00',
    );
    expect(html).toContain('class="card-score-value rate-poor"');
  });

  it('overall grade A produces badge-a class on weighted-total badge', () => {
    const html = renderHtml(
      [
        makeResult('react_quickstart', 'gpt-5.2', 'baseline', {
          overall_grade: 'A',
          overall_score: 95.0,
          dimensions: [{ name: 'friction', score: 95.0, weight: 0.15, grade: 'A' }],
        }),
      ],
      '2024-01-01 00:00',
    );
    expect(html).toContain('class="badge badge-lg badge-a"');
  });

  it('overall grade F produces badge-df class (shared with D) on weighted-total badge', () => {
    const html = renderHtml(
      [
        makeResult('react_quickstart', 'gpt-5.2', 'baseline', {
          overall_grade: 'F',
          overall_score: 20.0,
          dimensions: [{ name: 'friction', score: 20.0, weight: 0.15, grade: 'F' }],
        }),
      ],
      '2024-01-01 00:00',
    );
    expect(html).toContain('class="badge badge-lg badge-df"');
  });
});

// ── Mode toggle and summary panel tests ──────────────────────────────────────

describe('renderHtml mode toggle', () => {
  it('renders variant toggle buttons for each variant present', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline'),
      makeResult('react_quickstart', 'gpt-5.2', 'agent'),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    expect(html).toContain('class="mode-toggle-btn active" data-variant="baseline"');
    expect(html).toContain('data-variant="agent"');
  });

  it('renders agent+Skills as a separate toggle button', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline'),
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { tools: ['Skills'] }),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    expect(html).toContain('data-variant="baseline"');
    expect(html).toContain('data-variant="agent+Skills"');
    expect(html).not.toContain('data-variant="agent"');
  });

  it('renders one summary panel per variant', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline'),
      makeResult('react_quickstart', 'gpt-5.2', 'agent'),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    expect(html).toContain('class="summary-panel active" data-variant="baseline"');
    expect(html).toContain('class="summary-panel " data-variant="agent"');
  });

  it('summary table rows are models, columns are evals', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline'),
      makeResult('swift_quickstart', 'gpt-5.2', 'baseline'),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    // Model name appears as a row label
    expect(html).toContain('<td class="summary-eval-id">gpt-5.2</td>');
    // Eval names appear as column headers
    expect(html).toContain('react_quickstart');
    expect(html).toContain('swift_quickstart');
  });
});

// ── Delta badge tests ─────────────────────────────────────────────────────────

describe('renderHtml delta badges', () => {
  it('shows positive delta for agent mode improvement over baseline', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 0.5 }),
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { grader_pass_rate: 0.75 }),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    expect(html).toContain('delta-pos');
    expect(html).toContain('+25%');
  });

  it('shows negative delta for agent mode degradation from baseline', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 1.0 }),
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { grader_pass_rate: 0.75 }),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    expect(html).toContain('delta-neg');
    expect(html).toContain('-25%');
  });

  it('no delta shown on baseline tab', () => {
    const results = [makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 1.0 })];
    const html = renderHtml(results, '2024-01-01 00:00');
    // Extract only the body content (after </style>) to avoid matching CSS class definitions
    const body = html.slice(html.indexOf('</style>'));
    expect(body).not.toContain('class="delta delta-pos"');
    expect(body).not.toContain('class="delta delta-neg"');
    expect(body).not.toContain('class="delta delta-zero"');
  });
});

// ── Detail section tests ──────────────────────────────────────────────────────

describe('renderHtml detail section', () => {
  it('renders detail cards with mode badges', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline'),
      makeResult('react_quickstart', 'gpt-5.2', 'agent'),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    expect(html).toContain('class="mode-badge"');
    expect(html).toContain('detail-section-title');
  });

  it('renders all mode cards in a flat list per eval', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline'),
      makeResult('react_quickstart', 'gpt-5.2', 'agent'),
    ];
    const html = renderHtml(results, '2024-01-01 00:00');
    // Both modes should appear as mode badges in the same section (no tabs)
    const body = html.slice(html.indexOf('</style>'));
    const badgeMatches = body.match(/class="mode-badge"/g);
    expect(badgeMatches).not.toBeNull();
    expect(badgeMatches!.length).toBeGreaterThanOrEqual(2);
  });
});

// ── resultVariant tests ───────────────────────────────────────────────────────

describe('resultVariant', () => {
  it('returns mode for baseline', () => {
    expect(resultVariant(makeResult('r', 'm', 'baseline'))).toBe('baseline');
  });

  it('returns mode for agent with no tools', () => {
    expect(resultVariant(makeResult('r', 'm', 'agent', { tools: [] }))).toBe('agent');
  });

  it('returns mode+tools for agent with tools', () => {
    expect(resultVariant(makeResult('r', 'm', 'agent', { tools: ['Skills'] }))).toBe('agent+Skills');
  });

  it('handles missing tools field (backward compat)', () => {
    const r = makeResult('r', 'm', 'agent');
    delete r.tools;
    expect(resultVariant(r)).toBe('agent');
  });
});

// ── groupByVariant tests ──────────────────────────────────────────────────────

describe('groupByVariant', () => {
  it('groups results by variant, eval_id, model', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'baseline'),
      makeResult('react_quickstart', 'gpt-5.2', 'agent'),
    ];
    const grouped = groupByVariant(results);
    expect(grouped['baseline']['react_quickstart']['gpt-5.2']).toBeDefined();
    expect(grouped['agent']['react_quickstart']['gpt-5.2']).toBeDefined();
  });

  it('uses mode+tools as variant key for agent runs with tools', () => {
    const results = [makeResult('react_quickstart', 'gpt-5.2', 'agent', { tools: ['Skills'] })];
    const grouped = groupByVariant(results);
    expect(grouped['agent+Skills']['react_quickstart']['gpt-5.2']).toBeDefined();
    expect(grouped['agent']).toBeUndefined();
  });

  it('does not conflate agent runs with different tool configurations', () => {
    const results = [
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { tools: [] }),
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { tools: ['Skills'] }),
    ];
    const grouped = groupByVariant(results);
    expect(grouped['agent']['react_quickstart']['gpt-5.2']).toBeDefined();
    expect(grouped['agent+Skills']['react_quickstart']['gpt-5.2']).toBeDefined();
  });
});

// ── computeDeltas tests ───────────────────────────────────────────────────────

describe('computeDeltas', () => {
  it('computes positive delta correctly', () => {
    const variantGrouped = groupByVariant([
      makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 0.5 }),
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { grader_pass_rate: 0.75 }),
    ]);
    const deltas = computeDeltas(variantGrouped);
    expect(deltas['agent']['react_quickstart']['gpt-5.2']).toBeCloseTo(0.25);
  });

  it('computes negative delta correctly', () => {
    const variantGrouped = groupByVariant([
      makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 1.0 }),
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { grader_pass_rate: 0.75 }),
    ]);
    const deltas = computeDeltas(variantGrouped);
    expect(deltas['agent']['react_quickstart']['gpt-5.2']).toBeCloseTo(-0.25);
  });

  it('returns null delta when baseline is missing', () => {
    const variantGrouped = groupByVariant([
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { grader_pass_rate: 0.75 }),
    ]);
    const deltas = computeDeltas(variantGrouped);
    expect(deltas['agent']['react_quickstart']['gpt-5.2']).toBeNull();
  });

  it('computes delta for agent+Skills variant independently from agent', () => {
    const variantGrouped = groupByVariant([
      makeResult('react_quickstart', 'gpt-5.2', 'baseline', { grader_pass_rate: 0.5 }),
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { tools: [], grader_pass_rate: 0.6 }),
      makeResult('react_quickstart', 'gpt-5.2', 'agent', { tools: ['Skills'], grader_pass_rate: 1.0 }),
    ]);
    const deltas = computeDeltas(variantGrouped);
    expect(deltas['agent']['react_quickstart']['gpt-5.2']).toBeCloseTo(0.1);
    expect(deltas['agent+Skills']['react_quickstart']['gpt-5.2']).toBeCloseTo(0.5);
  });
});
