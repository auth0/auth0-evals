/**
 * Nunjucks filters for report.html.j2.
 *
 * CSS-class filters eliminate inline colour conditionals from the template —
 * each filter maps a data value to a CSS class name defined in the template's
 * <style> block.  Markdown-to-HTML conversion uses `marked`.
 */

import { marked, Marked } from 'marked';
import nunjucks from 'nunjucks';
import { MODES } from './report/processors.js';

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

// ── Template utility filters ─────────────────────────────────────────────────

/** Sort result keys: baseline < agent < agent+* (then by model). */
export function sortResultKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const aParts = a.split('|');
    const bParts = b.split('|');
    const aModel = aParts[0] ?? '';
    const aVariant = aParts[1] ?? '';
    const bModel = bParts[0] ?? '';
    const bVariant = bParts[1] ?? '';
    const aModeIdx = MODES.indexOf(aVariant) !== -1 ? MODES.indexOf(aVariant) : 99;
    const bModeIdx = MODES.indexOf(bVariant) !== -1 ? MODES.indexOf(bVariant) : 99;
    if (aModeIdx !== bModeIdx) return aModeIdx - bModeIdx;
    if (aVariant !== bVariant) return aVariant.localeCompare(bVariant);
    return aModel.localeCompare(bModel);
  });
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

/** Registers all filters on a Nunjucks environment. */
export function registerFilters(env: nunjucks.Environment): void {
  for (const [name, fn] of Object.entries(ALL_FILTERS)) {
    env.addFilter(name, fn);
  }
  env.addFilter('sort_result_keys', (obj: Record<string, unknown>) => sortResultKeys(Object.keys(obj)));
  env.addFilter('sort', (obj: unknown) => {
    if (Array.isArray(obj)) return [...obj].sort();
    if (obj && typeof obj === 'object') return Object.keys(obj as object).sort();
    return obj;
  });
  env.addFilter('selectattr', (arr: unknown[], attr: string, test?: string, val?: unknown) => {
    if (!Array.isArray(arr)) return [];
    if (test === 'equalto') return arr.filter((item) => (item as Record<string, unknown>)[attr] === val);
    return arr.filter((item) => !!(item as Record<string, unknown>)[attr]);
  });
  env.addFilter('repeat_str', (str: string, n: number) => new nunjucks.runtime.SafeString(str.repeat(Math.max(0, n))));
  env.addFilter('truncate_str', (str: string, n: number) => (str ? str.slice(0, n) : ''));
  env.addFilter('format', (fmt: string, ...args: unknown[]) => {
    let i = 0;
    return fmt.replace(/%\.(\d+)f|%\.(\d+)d|%s|%d/g, (match, decF, decD) => {
      const val = args[i++];
      if (match.startsWith('%.') && (decF || decD)) {
        const decimals = parseInt(decF ?? decD, 10);
        return Number(val).toFixed(decimals);
      }
      if (match === '%d') return String(Math.round(Number(val)));
      return String(val);
    });
  });
}
