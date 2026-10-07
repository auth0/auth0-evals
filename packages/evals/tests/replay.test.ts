import { describe, it, expect } from 'vitest';
import type { GraderResult } from '@a0/evals-graders';
import { judgeReplay, parseReplayScript, seededEnv } from '../src/cli/replay.js';

function result(name: string, passed: boolean): GraderResult {
  return { name, kind: 'contains', passed, detail: '' };
}

describe('parseReplayScript', () => {
  it('splits steps on one or more blank lines', () => {
    const text = 'echo one\n\necho two\n\n\n\necho three\n';
    expect(parseReplayScript(text)).toEqual({ steps: ['echo one', 'echo two', 'echo three'], breaks: [] });
  });

  it('joins multi-line steps with newlines and keeps indentation', () => {
    const text = 'auth0 api post /x \\\n  --data "{}" \\\n    --verbose\n\necho done';
    expect(parseReplayScript(text).steps).toEqual([
      'auth0 api post /x \\\n  --data "{}" \\\n    --verbose',
      'echo done',
    ]);
  });

  it('drops comment lines, including indented ones, without splitting a step', () => {
    const text = '# header\necho a\n  # indented comment\necho b\n\n# trailing\necho c';
    expect(parseReplayScript(text)).toEqual({ steps: ['echo a\necho b', 'echo c'], breaks: [] });
  });

  it.each([
    ['# breaks: Grader One', ['Grader One']],
    ['#breaks:Grader One', ['Grader One']],
    ['#   breaks:   padded name   ', ['padded name']],
    ['  # breaks: indented', ['indented']],
  ])('collects %j into breaks', (line, expected) => {
    expect(parseReplayScript(`${line}\necho a`)).toEqual({ steps: ['echo a'], breaks: expected });
  });

  it('collects multiple breaks and keeps them out of steps', () => {
    const text = '# breaks: First\n# breaks: Second\necho a\n# breaks: Third\necho b';
    expect(parseReplayScript(text)).toEqual({ steps: ['echo a\necho b'], breaks: ['First', 'Second', 'Third'] });
  });

  it('handles CRLF input', () => {
    const text = '# breaks: X\r\necho a\r\n  --flag\r\n\r\necho b\r\n';
    const parsed = parseReplayScript(text);
    expect(parsed).toEqual({ steps: ['echo a\n  --flag', 'echo b'], breaks: ['X'] });
    expect(parsed.steps.join('')).not.toContain('\r');
  });

  it.each([
    ['empty', ''],
    ['only newlines', '\n\n\n'],
    ['comment-only', '# one\n  # two\n\n# three\n'],
  ])('returns no steps or breaks for %s input', (_label, text) => {
    expect(parseReplayScript(text)).toEqual({ steps: [], breaks: [] });
  });

  it('treats whitespace-only lines as separators', () => {
    const text = 'echo a\n   \t \necho b\n  \necho c';
    expect(parseReplayScript(text).steps).toEqual(['echo a', 'echo b', 'echo c']);
  });
});

describe('seededEnv', () => {
  it.each([
    ['legacyAdminId', 'SEED_LEGACY_ADMIN_ID'],
    ['appId', 'SEED_APP_ID'],
    ['app2Id', 'SEED_APP2_ID'],
    ['org-name', 'SEED_ORG_NAME'],
    ['some.key name', 'SEED_SOME_KEY_NAME'],
    ['already_snake', 'SEED_ALREADY_SNAKE'],
  ])('maps key %s to %s', (key, name) => {
    expect(seededEnv({ [key]: 'v' })).toEqual({ [name]: 'v' });
  });

  it('stringifies numbers and booleans', () => {
    expect(seededEnv({ count: 3, enabled: true, off: false, zero: 0 })).toEqual({
      SEED_COUNT: '3',
      SEED_ENABLED: 'true',
      SEED_OFF: 'false',
      SEED_ZERO: '0',
    });
  });

  it('skips objects, arrays, null and undefined', () => {
    expect(seededEnv({ obj: { a: 1 }, arr: ['x'], nothing: null, missing: undefined, kept: 'yes' })).toEqual({
      SEED_KEPT: 'yes',
    });
  });

  it('returns an empty object for empty input', () => {
    expect(seededEnv({})).toEqual({});
  });
});

describe('judgeReplay', () => {
  describe('reference', () => {
    it('is ok when all graders pass', () => {
      expect(judgeReplay('reference', [result('A', true), result('B', true)], [])).toEqual({
        ok: true,
        reason: 'all graders passed',
      });
    });

    it('is ok when there are no results', () => {
      expect(judgeReplay('reference', [], []).ok).toBe(true);
    });

    it('fails listing failed grader names', () => {
      expect(judgeReplay('reference', [result('A', false), result('B', true), result('C', false)], [])).toEqual({
        ok: false,
        reason: 'reference failed: A; C',
      });
    });
  });

  describe('mutant without breaks', () => {
    it('is ok when at least one grader fails', () => {
      expect(judgeReplay('mutant', [result('A', true), result('B', false), result('C', false)], [])).toEqual({
        ok: true,
        reason: 'caught by: B; C',
      });
    });

    it('is not ok when every grader passes', () => {
      expect(judgeReplay('mutant', [result('A', true)], [])).toEqual({
        ok: false,
        reason: 'mutant passed every grader',
      });
    });

    it('is not ok when there are no results', () => {
      expect(judgeReplay('mutant', [], []).ok).toBe(false);
    });
  });

  describe('mutant with breaks', () => {
    it('is ok when every named grader fails, even if others pass', () => {
      const results = [result('A', false), result('B', false), result('C', true)];
      expect(judgeReplay('mutant', results, ['A', 'B'])).toEqual({ ok: true, reason: 'caught by: A; B' });
    });

    it('is ok when unnamed graders also fail', () => {
      const results = [result('A', false), result('B', false)];
      expect(judgeReplay('mutant', results, ['A']).ok).toBe(true);
    });

    it('is not ok listing the named graders that passed', () => {
      const results = [result('A', false), result('B', true), result('C', true)];
      expect(judgeReplay('mutant', results, ['A', 'B', 'C'])).toEqual({
        ok: false,
        reason: 'expected to fail but passed: B; C',
      });
    });

    it('is not ok when a break names an unknown grader', () => {
      expect(judgeReplay('mutant', [result('A', false)], ['Nope'])).toEqual({
        ok: false,
        reason: 'no grader named: Nope',
      });
    });

    it('reports unknown graders before missed ones', () => {
      const results = [result('A', true)];
      expect(judgeReplay('mutant', results, ['A', 'Ghost', 'Phantom'])).toEqual({
        ok: false,
        reason: 'no grader named: Ghost; Phantom',
      });
    });
  });
});
