/**
 * Unit tests for report-filters.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  finishCssClass,
  latencyCssClass,
  actionCssClass,
  sizeCssClass,
  mdInline,
  judgeHtml,
} from '../src/report-filters.js';

// ── finishCssClass ────────────────────────────────────────────────────────────

describe('finishCssClass', () => {
  it.each([
    // Underscores are converted to hyphens before lookup
    ['tool_calls', 'finish-tool-calls'],
    ['stop', 'finish-stop'],
    ['max_tokens', 'finish-max-tokens'],
    ['length', 'finish-length'],
    // Unrecognised reasons fall back to finish-unknown
    ['end_turn', 'finish-unknown'],
    ['', 'finish-unknown'],
  ] as [string, string][])('%j → %s', (reason, expected) => {
    expect(finishCssClass(reason)).toBe(expected);
  });
});

// ── latencyCssClass ───────────────────────────────────────────────────────────

describe('latencyCssClass', () => {
  it.each([
    // Fast: < 5 s
    [0, 'lat-fast'],
    [4.9, 'lat-fast'],
    // Medium: [5, 15)
    [5, 'lat-medium'],
    [14.9, 'lat-medium'],
    // Slow: >= 15 s
    [15, 'lat-slow'],
    [60, 'lat-slow'],
  ] as [number, string][])('%ds → %s', (seconds, expected) => {
    expect(latencyCssClass(seconds)).toBe(expected);
  });
});

// ── actionCssClass ────────────────────────────────────────────────────────────

describe('actionCssClass', () => {
  it.each([
    ['Implementation', 'action-implementation'],
    ['Discovery', 'action-discovery'],
    ['Error', 'action-error'],
    // Empty / falsy falls back to action-unknown
    ['', 'action-unknown'],
  ] as [string, string][])('%j → %s', (action, expected) => {
    expect(actionCssClass(action)).toBe(expected);
  });
});

// ── sizeCssClass ──────────────────────────────────────────────────────────────

describe('sizeCssClass', () => {
  it.each([
    // Below 5 KB
    [0, 'size-moderate'],
    [5 * 1024 - 1, 'size-moderate'],
    // [5 KB, 10 KB)
    [5 * 1024, 'size-large'],
    [10 * 1024 - 1, 'size-large'],
    // >= 10 KB
    [10 * 1024, 'size-xlarge'],
    [100 * 1024, 'size-xlarge'],
  ] as [number, string][])('%i bytes → %s', (bytes, expected) => {
    expect(sizeCssClass(bytes)).toBe(expected);
  });
});

// ── mdInline ──────────────────────────────────────────────────────────────────

describe('mdInline', () => {
  it('renders bold markdown to <strong>', () => {
    expect(mdInline('**bold**')).toContain('<strong>bold</strong>');
  });

  it('renders inline code to <code>', () => {
    expect(mdInline('`code`')).toContain('<code>code</code>');
  });

  it('leaves plain text unchanged', () => {
    expect(mdInline('plain text')).toBe('plain text');
  });
});

// ── judgeHtml ─────────────────────────────────────────────────────────────────

describe('judgeHtml', () => {
  it('returns empty string for empty input', () => {
    expect(judgeHtml('')).toBe('');
  });

  it('extracts model name from "Judge (model):" header', () => {
    const detail = 'Judge (claude-3-5-sonnet):\nThe answer is correct.';
    const html = judgeHtml(detail);
    expect(html).toContain('claude-3-5-sonnet');
    expect(html).toContain('judge-model-badge');
  });

  it('falls back to "judge" when header does not match pattern', () => {
    const detail = 'No header here\nSome reasoning.';
    const html = judgeHtml(detail);
    expect(html).toContain('>judge<');
  });

  it('renders body markdown inside judge-reasoning-body', () => {
    const detail = 'Judge (model):\n**Correct** because the logic holds.';
    const html = judgeHtml(detail);
    expect(html).toContain('judge-reasoning-body');
    expect(html).toContain('<strong>Correct</strong>');
  });

  it('shows no-reasoning placeholder when body is empty', () => {
    const detail = 'Judge (model):';
    const html = judgeHtml(detail);
    expect(html).toContain('no-reasoning');
  });

  it('escapes HTML in the model name', () => {
    const detail = 'Judge (<script>):\nReasoning.';
    const html = judgeHtml(detail);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('strips <script> tags injected in the reasoning body', () => {
    const detail = 'Judge (model):\nLooks good.\n\n<script>alert(1)</script>';
    const html = judgeHtml(detail);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('strips inline HTML with event handlers injected in the reasoning body', () => {
    const detail = 'Judge (model):\nLooks good.\n\n<img src=x onerror=alert(1)>';
    const html = judgeHtml(detail);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('renders reasoning when the detail begins with a blank line', () => {
    // Regression: an empty first line made `!firstLine` true, discarding all
    // reasoning even though the detail was non-empty.
    const detail = '\nThe answer is correct.';
    const html = judgeHtml(detail);
    expect(html).not.toBe('');
    expect(html).toContain('The answer is correct.');
    expect(html).toContain('judge-reasoning-body');
  });
});
