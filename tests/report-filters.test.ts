/**
 * Unit tests for report-filters.ts.
 */

import { describe, it, expect } from 'vitest';
import { rateCssClass, gradeCssClass } from '../src/report-filters.js';

// ── rateCssClass ──────────────────────────────────────────────────────────────

describe('rateCssClass', () => {
  it.each([
    // Exact boundary: 1.0 is the only "excellent" value
    [1.0, 'rate-excellent'],
    // Good tier: [0.75, 1.0)
    [0.99, 'rate-good'],
    [0.75, 'rate-good'],
    // Fair tier: [0.5, 0.75)
    [0.74, 'rate-fair'],
    [0.5, 'rate-fair'],
    // Poor tier: below 0.5
    [0.49, 'rate-poor'],
    [0.0, 'rate-poor'],
  ] as [number, string][])('rate %f → %s', (rate, expected) => {
    expect(rateCssClass(rate)).toBe(expected);
  });
});

// ── gradeCssClass ─────────────────────────────────────────────────────────────

describe('gradeCssClass', () => {
  it.each([
    ['A', 'badge-a'],
    ['B', 'badge-b'],
    ['C', 'badge-c'],
    // D and F share the same red badge class
    ['D', 'badge-df'],
    ['F', 'badge-df'],
    // Unknown or missing grade produces an empty string
    ['', ''],
    ['Z', ''],
  ] as [string, string][])('grade %j → %s', (grade, expected) => {
    expect(gradeCssClass(grade)).toBe(expected);
  });
});
