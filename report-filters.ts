/**
 * Nunjucks filters for report.html.j2.
 *
 * CSS-class filters eliminate inline colour conditionals from the template —
 * each filter maps a data value to a CSS class name defined in the template's
 * <style> block.
 */

// ── CSS-class filters ─────────────────────────────────────────────────────────

export function rateCssClass(rate: number): string {
  if (rate === 1.0) return 'rate-excellent';
  if (rate >= 0.75) return 'rate-good';
  if (rate >= 0.5) return 'rate-fair';
  return 'rate-poor';
}

const GRADE_TO_BADGE_CLASS: Record<string, string> = {
  A: 'badge-a',
  B: 'badge-b',
  C: 'badge-c',
  D: 'badge-df',
  F: 'badge-df',
};

export function gradeCssClass(grade: string): string {
  return GRADE_TO_BADGE_CLASS[grade] ?? '';
}

// ── Registration helper ───────────────────────────────────────────────────────

export const ALL_FILTERS: Record<string, (val: unknown) => string> = {
  rate_css_class: (val) => rateCssClass(val as number),
  grade_css_class: (val) => gradeCssClass(val as string),
};
