import { describe, it, expect } from 'vitest';
import { formatCommandTrace } from '../src/graders/executors/llm-judge.js';
import type { EventToolCall } from '@a0/evals-graders';

// ── fixtures ─────────────────────────────────────────────────────────────────

function tc(
  name: string,
  command: string,
  causedError = false,
  result = '',
): EventToolCall {
  return { name, args: { command }, result, causedError };
}

const ok = (command: string) => tc('run_command', command, false, '');
const failed = (command: string, result = 'something went wrong') =>
  tc('run_command', command, true, result);
const okBash = (command: string) => tc('bash', command, false, '');

// ── empty input ──────────────────────────────────────────────────────────────

describe('formatCommandTrace — empty input', () => {
  it('returns empty string for zero tool calls (no opts)', () => {
    expect(formatCommandTrace([])).toBe('');
  });

  it('returns empty string for zero tool calls (includeFailed: true)', () => {
    expect(formatCommandTrace([], { includeFailed: true })).toBe('');
  });

  it('returns empty string when only non-command tools are present', () => {
    const calls: EventToolCall[] = [
      { name: 'read_file', args: { path: 'x' }, result: '', causedError: false },
      { name: 'write_file', args: { path: 'y', content: 'z' }, result: '', causedError: false },
    ];
    expect(formatCommandTrace(calls)).toBe('');
    expect(formatCommandTrace(calls, { includeFailed: true })).toBe('');
  });
});

// ── default mode (no opts / includeFailed: false) ────────────────────────────
//
// REGRESSION GUARD: errored commands must be absent; only successful commands
// appear; the header must claim every command exited successfully.

describe('formatCommandTrace — default (success-only)', () => {
  it('includes successful run_command calls', () => {
    const out = formatCommandTrace([ok('npx auth0 login')]);
    expect(out).toContain('npx auth0 login');
  });

  it('includes successful bash calls', () => {
    const out = formatCommandTrace([okBash('npm install @auth0/auth0-react')]);
    expect(out).toContain('npm install @auth0/auth0-react');
  });

  it('excludes errored commands', () => {
    const out = formatCommandTrace([
      ok('npx auth0 login'),
      failed('npx auth0 deploy', 'ENOENT'),
    ]);
    expect(out).toContain('npx auth0 login');
    expect(out).not.toContain('npx auth0 deploy');
    expect(out).not.toContain('[FAILED]');
    expect(out).not.toContain('ENOENT');
  });

  it('returns empty string when all commands errored', () => {
    const out = formatCommandTrace([failed('npm ci', 'exit code 1')]);
    expect(out).toBe('');
  });

  it('header asserts every listed command exited successfully', () => {
    const out = formatCommandTrace([ok('npx auth0 login')]);
    expect(out).toContain('Every command listed here exited');
    // Must NOT contain language suggesting failures are also shown.
    expect(out).not.toContain('[FAILED]');
  });

  it('mixed trace: only successful commands survive', () => {
    const out = formatCommandTrace([
      ok('auth0 login'),
      failed('auth0 deploy', 'Deploy error'),
      ok('auth0 apps list'),
    ]);
    expect(out).toContain('auth0 login');
    expect(out).toContain('auth0 apps list');
    expect(out).not.toContain('auth0 deploy');
    expect(out).not.toContain('Deploy error');
  });

  it('explicit includeFailed: false behaves identically to no opts', () => {
    const calls = [ok('auth0 login'), failed('auth0 deploy', 'err')];
    expect(formatCommandTrace(calls, { includeFailed: false })).toBe(formatCommandTrace(calls));
  });
});

// ── includeFailed: true ──────────────────────────────────────────────────────

describe('formatCommandTrace — includeFailed: true', () => {
  it('prefixes errored commands with [FAILED]', () => {
    const out = formatCommandTrace([failed('auth0 deploy', 'ENOENT: file not found')], {
      includeFailed: true,
    });
    expect(out).toContain('[FAILED] auth0 deploy');
  });

  it('includes a — error: excerpt for failed commands', () => {
    const out = formatCommandTrace([failed('auth0 deploy', 'ENOENT: file not found')], {
      includeFailed: true,
    });
    expect(out).toContain('— error: ENOENT: file not found');
  });

  it('successful commands appear without [FAILED] prefix', () => {
    const out = formatCommandTrace(
      [ok('auth0 login'), failed('auth0 deploy', 'err')],
      { includeFailed: true },
    );
    const lines = out.split('\n').filter((l) => !l.startsWith('//'));
    const loginLine = lines.find((l) => l.includes('auth0 login'));
    expect(loginLine).toBeDefined();
    expect(loginLine).not.toContain('[FAILED]');
  });

  it('both successful and failed commands appear together', () => {
    const out = formatCommandTrace(
      [ok('auth0 login'), failed('auth0 deploy', 'Deploy failed')],
      { includeFailed: true },
    );
    expect(out).toContain('auth0 login');
    expect(out).toContain('[FAILED] auth0 deploy');
  });

  it('header does NOT claim every command succeeded', () => {
    const out = formatCommandTrace([ok('auth0 login'), failed('auth0 deploy', 'err')], {
      includeFailed: true,
    });
    // The success-only header phrase must be absent.
    expect(out).not.toContain('Every command listed here exited');
    // The includeFailed header distinguishes failed commands explicitly.
    expect(out).toContain('[FAILED]');
  });

  it('collapses whitespace in the error excerpt', () => {
    const out = formatCommandTrace(
      [failed('cmd', 'line one\n  line two\n\tline three')],
      { includeFailed: true },
    );
    // Newlines / tabs collapsed to single spaces.
    expect(out).toContain('line one line two line three');
  });

  it('truncates error excerpt longer than 200 chars to end with …', () => {
    const longError = 'x'.repeat(250);
    const out = formatCommandTrace([failed('cmd', longError)], { includeFailed: true });
    // excerpt must be capped and end with the ellipsis character.
    expect(out).toContain('…');
    const excerptMatch = out.match(/— error: (.+)/);
    expect(excerptMatch).not.toBeNull();
    const excerpt = excerptMatch![1];
    // 200 chars of 'x' plus '…' = 201 chars.
    expect(excerpt.length).toBeLessThanOrEqual(201);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('does not truncate error excerpt at or below 200 chars', () => {
    const exactError = 'y'.repeat(200);
    const out = formatCommandTrace([failed('cmd', exactError)], { includeFailed: true });
    expect(out).not.toContain('…');
    expect(out).toContain('y'.repeat(200));
  });

  it('returns empty string when the only tool call is a non-command', () => {
    const calls: EventToolCall[] = [
      { name: 'read_file', args: { path: 'x' }, result: '', causedError: false },
    ];
    expect(formatCommandTrace(calls, { includeFailed: true })).toBe('');
  });
});
