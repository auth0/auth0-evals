/**
 * Nunjucks filters for report.html.j2.
 *
 * CSS-class filters eliminate inline colour conditionals from the template —
 * each filter maps a data value to a CSS class name defined in the template's
 * <style> block.  Markdown-to-HTML conversion uses `marked`.
 */

import { marked, Marked } from 'marked';

// Marked instance used for judge reasoning. Raw HTML tokens are stripped so
// that injected <script> tags or event-handler attributes in LLM output cannot
// reach the generated report.
const safeMarked = new Marked({ renderer: { html: () => '' } });

// Simple HTML escape function
function htmlEscape(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── CSS-class filters ─────────────────────────────────────────────────────────

export function rateCssClass(rate: number): string {
  if (rate === 1.0) return 'rate-excellent';
  if (rate >= 0.75) return 'rate-good';
  if (rate >= 0.5) return 'rate-fair';
  return 'rate-poor';
}

export function gradeCssClass(grade: string): string {
  const GRADE_TO_BADGE_CLASS: Record<string, string> = {
    A: 'badge-a',
    B: 'badge-b',
    C: 'badge-c',
    D: 'badge-df',
    F: 'badge-df',
  };
  return GRADE_TO_BADGE_CLASS[grade] ?? '';
}

export function finishCssClass(reason: string): string {
  const slug = reason.replace(/_/g, '-');
  if (['tool-calls', 'stop', 'max-tokens', 'length'].includes(slug)) {
    return `finish-${slug}`;
  }
  return 'finish-unknown';
}

export function latencyCssClass(seconds: number): string {
  if (seconds < 5) return 'lat-fast';
  if (seconds < 15) return 'lat-medium';
  return 'lat-slow';
}

export function actionCssClass(action: string): string {
  if (!action) return 'action-unknown';
  return `action-${action.toLowerCase()}`;
}

export function sizeCssClass(sizeBytes: number): string {
  if (sizeBytes >= 10 * 1024) return 'size-xlarge';
  if (sizeBytes >= 5 * 1024) return 'size-large';
  return 'size-moderate';
}

// ── Inline-markdown filter ───────────────────────────────────────────────────

export function mdInline(text: string): string {
  return marked.parseInline(text) as string;
}

// ── Judge reasoning renderer ─────────────────────────────────────────────────

export function judgeHtml(detail: string): string {
  if (!detail) {
    return '';
  }

  const [firstLine, ...bodyLines] = detail.split('\n');

  if (!firstLine) {
    return '';
  }

  const modelMatch = /Judge \(([^)]+)\):\s*/.exec(firstLine);
  const model = modelMatch && modelMatch[1] ? modelMatch[1] : 'judge';

  // The reasoning starts on the same line as the "Judge (model): " prefix.
  // Strip the prefix to recover it, then join with any remaining lines.
  const firstLineReasoning = modelMatch ? firstLine.slice(modelMatch[0].length) : firstLine;
  const body = [firstLineReasoning, ...bodyLines].join('\n').trim();

  const rendered =
    body && body.length > 0 ? safeMarked.parse(body) : '<p class="no-reasoning">No reasoning provided.</p>';

  return (
    '<div class="judge-reasoning-block">' +
    `<div class="judge-model-badge">${htmlEscape(model)}</div>` +
    `<div class="judge-reasoning-body">${rendered}</div>` +
    '</div>'
  );
}

// ── Registration helper ───────────────────────────────────────────────────────

export const ALL_FILTERS: Record<string, (val: unknown) => string> = {
  rate_css_class: (val) => rateCssClass(val as number),
  grade_css_class: (val) => gradeCssClass(val as string),
  finish_css_class: (val) => finishCssClass(val as string),
  latency_css_class: (val) => latencyCssClass(val as number),
  action_css_class: (val) => actionCssClass(val as string),
  size_css_class: (val) => sizeCssClass(val as number),
  md_inline: (val) => mdInline(val as string),
  judge_html: (val) => judgeHtml(val as string),
};
