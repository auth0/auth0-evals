import { describe, it, expect } from 'vitest';
import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  compiles,
  ranCommand,
  ranCommandOneOf,
  wroteFile,
} from '../src/primitives.js';
import { GraderLevel } from '../src/types.js';
import type { EventToolCall } from '../src/types.js';

// Builds a synthetic EventToolCall for exercising event-grader predicates.
function evt(overrides: Partial<EventToolCall> & { name: string }): EventToolCall {
  return { args: {}, result: '', causedError: false, ...overrides };
}

// ── contains ──────────────────────────────────────────────────────────────────

describe('contains', () => {
  it('creates a GraderDef with kind "contains"', () => {
    const def = contains('Auth0Provider');
    expect(def.kind).toBe('contains');
    expect(def.needle).toBe('Auth0Provider');
  });

  it('uses needle in auto-generated name', () => {
    const def = contains('Auth0Provider');
    expect(def.name).toBe("contains 'Auth0Provider'");
  });

  it('uses custom description as name', () => {
    const def = contains('Auth0Provider', 'has Auth0Provider import');
    expect(def.name).toBe('has Auth0Provider import');
  });

  it('sets level when provided', () => {
    const def = contains('Auth0Provider', undefined, GraderLevel.L1);
    expect(def.level).toBe(GraderLevel.L1);
  });

  it('defaults to case-sensitive', () => {
    const def = contains('Auth0Provider');
    expect(def.caseSensitive).toBe(true);
  });

  it('respects caseSensitive option', () => {
    const def = contains('Auth0Provider', undefined, undefined, { caseSensitive: false });
    expect(def.caseSensitive).toBe(false);
  });
});

// ── notContains ───────────────────────────────────────────────────────────────

describe('notContains', () => {
  it('creates a GraderDef with kind "not_contains"', () => {
    const def = notContains('fake-package');
    expect(def.kind).toBe('not_contains');
    expect(def.needle).toBe('fake-package');
  });

  it('uses needle in auto-generated name', () => {
    const def = notContains('fake-package');
    expect(def.name).toBe("not_contains 'fake-package'");
  });

  it('uses custom description as name', () => {
    const def = notContains('fake-package', 'no hallucinated package');
    expect(def.name).toBe('no hallucinated package');
  });

  it('sets level when provided', () => {
    const def = notContains('fake-package', undefined, GraderLevel.L2);
    expect(def.level).toBe(GraderLevel.L2);
  });

  it('defaults to case-sensitive', () => {
    const def = notContains('fake-package');
    expect(def.caseSensitive).toBe(true);
  });

  it('respects caseSensitive option', () => {
    const def = notContains('fake-package', undefined, undefined, { caseSensitive: false });
    expect(def.caseSensitive).toBe(false);
  });
});

// ── notContainsInSource ───────────────────────────────────────────────────────

describe('notContainsInSource', () => {
  it('creates a GraderDef with kind "not_contains_in_source"', () => {
    const def = notContainsInSource('hardcoded-secret');
    expect(def.kind).toBe('not_contains_in_source');
    expect(def.needle).toBe('hardcoded-secret');
  });

  it('uses needle in auto-generated name', () => {
    const def = notContainsInSource('hardcoded-secret');
    expect(def.name).toBe("not_contains_in_source 'hardcoded-secret'");
  });

  it('uses custom description as name', () => {
    const def = notContainsInSource('hardcoded-secret', 'no hardcoded secrets');
    expect(def.name).toBe('no hardcoded secrets');
  });

  it('sets level when provided', () => {
    const def = notContainsInSource('hardcoded-secret', undefined, GraderLevel.L3);
    expect(def.level).toBe(GraderLevel.L3);
  });

  it('defaults to case-sensitive', () => {
    const def = notContainsInSource('hardcoded-secret');
    expect(def.caseSensitive).toBe(true);
  });

  it('respects caseSensitive option', () => {
    const def = notContainsInSource('hardcoded-secret', undefined, undefined, { caseSensitive: false });
    expect(def.caseSensitive).toBe(false);
  });
});

// ── matches ───────────────────────────────────────────────────────────────────

describe('matches', () => {
  it('creates a GraderDef with kind "matches"', () => {
    const def = matches('useAuth0\\(');
    expect(def.kind).toBe('matches');
    expect(def.pattern).toBe('useAuth0\\(');
  });

  it('uses pattern in auto-generated name', () => {
    const def = matches('useAuth0\\(');
    expect(def.name).toBe('matches /useAuth0\\(/');
  });

  it('uses custom description as name', () => {
    const def = matches('useAuth0\\(', 'calls useAuth0 hook');
    expect(def.name).toBe('calls useAuth0 hook');
  });

  it('sets level when provided', () => {
    const def = matches('useAuth0\\(', undefined, GraderLevel.L4);
    expect(def.level).toBe(GraderLevel.L4);
  });

  it('does not set caseSensitive (not applicable)', () => {
    const def = matches('pattern');
    expect(def.caseSensitive).toBeUndefined();
  });
});

// ── judge ─────────────────────────────────────────────────────────────────────

describe('judge', () => {
  it('creates a GraderDef with kind "judge"', () => {
    const def = judge('Does the code correctly initialize Auth0?');
    expect(def.kind).toBe('judge');
    expect(def.question).toBe('Does the code correctly initialize Auth0?');
  });

  it('uses question as name', () => {
    const def = judge('Does the code correctly initialize Auth0?');
    expect(def.name).toBe('Does the code correctly initialize Auth0?');
  });

  it('sets level when provided', () => {
    const def = judge('Is this correct?', GraderLevel.L5);
    expect(def.level).toBe(GraderLevel.L5);
  });

  it('leaves level undefined when not provided', () => {
    const def = judge('Is this correct?');
    expect(def.level).toBeUndefined();
  });
});

// ── compiles ──────────────────────────────────────────────────────────────────

describe('compiles', () => {
  it('returns a compile-kind grader with the given level and name', () => {
    const g = compiles('verifies the build', GraderLevel.L4);
    expect(g.kind).toBe('compile');
    expect(g.level).toBe(GraderLevel.L4);
    expect(g.name).toBe('verifies the build');
    expect(g.predicate).toBeUndefined();
  });

  it('falls back to a default name when description is omitted', () => {
    const g = compiles(undefined, GraderLevel.L4);
    expect(g.name).toBe('compiles successfully');
  });

  it('accepts L5', () => {
    expect(compiles('build', GraderLevel.L5).level).toBe(GraderLevel.L5);
  });

  it('rejects non-event levels', () => {
    // @ts-expect-error — L1 is not an EventGraderLevel
    expect(() => compiles('build', GraderLevel.L1)).toThrow('event-based graders only support');
  });
});

// ── ranCommand (predicate) ──────────────────────────────────────────────────

describe('ranCommand predicate', () => {
  const run = (def: ReturnType<typeof ranCommand>, calls: EventToolCall[]) => def.predicate!(calls);

  it('matches a run_command whose command contains the substring', () => {
    const def = ranCommand('npm install', undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'run_command', args: { command: 'npm install @auth0/auth0-react' } })])).toBe(true);
  });

  it("matches Gemini's bash tool name", () => {
    const def = ranCommand('npm install', undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'bash', args: { command: 'npm install @auth0/auth0-react' } })])).toBe(true);
  });

  it('requires all args to appear in the command', () => {
    const def = ranCommand('npm', ['install', '@auth0/auth0-react'], undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'run_command', args: { command: 'npm install @auth0/auth0-react' } })])).toBe(true);
    expect(run(def, [evt({ name: 'run_command', args: { command: 'npm install react' } })])).toBe(false);
  });

  it('ignores commands that errored', () => {
    const def = ranCommand('npm install', undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'run_command', args: { command: 'npm install' }, causedError: true })])).toBe(false);
  });

  it('returns false when no command matches', () => {
    const def = ranCommand('npm install', undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'run_command', args: { command: 'ls -la' } })])).toBe(false);
  });

  it('throws on a non-event level', () => {
    // @ts-expect-error — L1 is not an EventGraderLevel
    expect(() => ranCommand('npm install', undefined, undefined, GraderLevel.L1)).toThrow(
      'event-based graders only support',
    );
  });
});

// ── ranCommandOneOf (predicate) ─────────────────────────────────────────────

describe('ranCommandOneOf predicate', () => {
  const run = (def: ReturnType<typeof ranCommandOneOf>, calls: EventToolCall[]) => def.predicate!(calls);

  it('matches when at least one alternative is present', () => {
    const def = ranCommandOneOf(['npm install', 'yarn add', 'pnpm add'], undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'bash', args: { command: 'yarn add @auth0/auth0-react' } })])).toBe(true);
  });

  it('returns false when none of the alternatives are present', () => {
    const def = ranCommandOneOf(['npm install', 'yarn add'], undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'run_command', args: { command: 'pip install requests' } })])).toBe(false);
  });
});

// ── wroteFile (predicate) ───────────────────────────────────────────────────

describe('wroteFile predicate', () => {
  const run = (def: ReturnType<typeof wroteFile>, calls: EventToolCall[]) => def.predicate!(calls);

  it('matches a write whose path contains the substring', () => {
    const def = wroteFile('.env', undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'write_file', args: { path: 'app/.env.local', content: 'X=1' } })])).toBe(true);
  });

  it("matches Gemini's write/edit tool names", () => {
    const def = wroteFile('main.ts', undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'write', args: { path: 'src/main.ts', content: 'x' } })])).toBe(true);
    expect(run(def, [evt({ name: 'edit', args: { path: 'src/main.ts', content: 'y' } })])).toBe(true);
  });

  it('ignores writes that errored', () => {
    const def = wroteFile('.env', undefined, GraderLevel.L4);
    expect(run(def, [evt({ name: 'write_file', args: { path: '.env', content: 'X=1' }, causedError: true })])).toBe(
      false,
    );
  });

  it('requires all expected substrings in the combined content of matching writes', () => {
    const def = wroteFile('.env', undefined, GraderLevel.L4, ['CLIENT_ID', 'DOMAIN']);
    // Content split across two writes to the same path is combined.
    const calls = [
      evt({ name: 'write_file', args: { path: '.env', content: 'AUTH0_CLIENT_ID=abc' } }),
      evt({ name: 'write_file', args: { path: '.env', content: 'AUTH0_DOMAIN=example.auth0.com' } }),
    ];
    expect(run(def, calls)).toBe(true);
  });

  it('fails when an expected substring is missing from the combined content', () => {
    const def = wroteFile('.env', undefined, GraderLevel.L4, ['CLIENT_ID', 'DOMAIN']);
    expect(run(def, [evt({ name: 'write_file', args: { path: '.env', content: 'AUTH0_CLIENT_ID=abc' } })])).toBe(false);
  });

  it('does not combine content from writes to a different path', () => {
    const def = wroteFile('.env', undefined, GraderLevel.L4, ['CLIENT_ID', 'DOMAIN']);
    const calls = [
      evt({ name: 'write_file', args: { path: '.env', content: 'AUTH0_CLIENT_ID=abc' } }),
      evt({ name: 'write_file', args: { path: 'other.txt', content: 'AUTH0_DOMAIN=example.auth0.com' } }),
    ];
    expect(run(def, calls)).toBe(false);
  });
});
