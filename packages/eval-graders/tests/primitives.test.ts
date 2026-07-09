import { describe, it, expect } from 'vitest';
import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  compiles,
  ranCommandsInOrder,
} from '../src/primitives.js';
import { GraderLevel } from '../src/types.js';
import type { EventToolCall } from '../src/types.js';

/** Build a run_command tool-call record for event-grader tests. */
function cmd(command: string): EventToolCall {
  return { name: 'run_command', args: { command }, result: '', causedError: false };
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

  it('defaults includeCommandTrace to false', () => {
    const def = judge('Is this correct?');
    expect(def.includeCommandTrace).toBe(false);
  });

  it('sets includeCommandTrace when opted in via options', () => {
    const def = judge('Did the CLI enforce MFA?', undefined, { includeCommandTrace: true });
    expect(def.includeCommandTrace).toBe(true);
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

// ── ranCommandsInOrder ──────────────────────────────────────────────────────

describe('ranCommandsInOrder', () => {
  it('returns an event-kind grader with the given level and name', () => {
    const g = ranCommandsInOrder(['a', 'b'], 'ran a then b', GraderLevel.L4);
    expect(g.kind).toBe('event');
    expect(g.level).toBe(GraderLevel.L4);
    expect(g.name).toBe('ran a then b');
    expect(typeof g.predicate).toBe('function');
  });

  it('passes when steps ran in order and adjacent', () => {
    const g = ranCommandsInOrder(['factors/otp', 'guardian/policies'], undefined, GraderLevel.L4);
    const calls = [cmd('auth0 api put guardian/factors/otp'), cmd('auth0 api put guardian/policies')];
    expect(g.predicate!(calls)).toBe(true);
  });

  it('passes when ordered steps are non-adjacent (other commands between)', () => {
    const g = ranCommandsInOrder(['factors/otp', 'guardian/policies'], undefined, GraderLevel.L4);
    const calls = [
      cmd('auth0 api put guardian/factors/otp'),
      cmd('npm run build'),
      cmd('auth0 api put guardian/policies'),
    ];
    expect(g.predicate!(calls)).toBe(true);
  });

  it('fails when steps ran in the wrong order', () => {
    const g = ranCommandsInOrder(['factors/otp', 'guardian/policies'], undefined, GraderLevel.L4);
    const calls = [cmd('auth0 api put guardian/policies'), cmd('auth0 api put guardian/factors/otp')];
    expect(g.predicate!(calls)).toBe(false);
  });

  it('fails when a required step is missing', () => {
    const g = ranCommandsInOrder(['factors/otp', 'guardian/policies'], undefined, GraderLevel.L4);
    const calls = [cmd('auth0 api put guardian/factors/otp')];
    expect(g.predicate!(calls)).toBe(false);
  });

  it('treats an array step as a one-of alternative', () => {
    const g = ranCommandsInOrder(
      [['factors/otp', 'factors/push', 'factors/sms'], 'guardian/policies'],
      undefined,
      GraderLevel.L4,
    );
    const calls = [cmd('auth0 api put guardian/factors/push'), cmd('auth0 api put guardian/policies')];
    expect(g.predicate!(calls)).toBe(true);
  });

  it('does not reuse a single match for two steps', () => {
    // A single occurrence of a needle must not satisfy two steps — the second
    // step has to match text that starts after the first step's match ends.
    const g = ranCommandsInOrder(['guardian', 'guardian'], undefined, GraderLevel.L4);
    const calls = [cmd('auth0 api put guardian/factors/otp')];
    expect(g.predicate!(calls)).toBe(false);
  });

  it('passes when ordered steps are chained in a single command', () => {
    // Agents commonly run "enable factor && enforce policy" as one shell call.
    // Ordering within a single command must count — the steps are still ordered.
    const g = ranCommandsInOrder(
      [['guardian/factors/otp', 'guardian/factors/push', 'guardian/factors/sms'], 'guardian/policies'],
      undefined,
      GraderLevel.L4,
    );
    const calls = [
      cmd(
        'auth0 api put guardian/factors/otp --data \'{"enabled":true}\' && ' +
          'auth0 api put guardian/policies --data \'["all-applications"]\'',
      ),
    ];
    expect(g.predicate!(calls)).toBe(true);
  });

  it('fails when steps are chained in a single command but in the wrong order', () => {
    const g = ranCommandsInOrder(['guardian/factors/otp', 'guardian/policies'], undefined, GraderLevel.L4);
    const calls = [cmd('auth0 api put guardian/policies && auth0 api put guardian/factors/otp')];
    expect(g.predicate!(calls)).toBe(false);
  });

  it('ignores errored commands', () => {
    const g = ranCommandsInOrder(['factors/otp', 'guardian/policies'], undefined, GraderLevel.L4);
    const calls = [
      { name: 'run_command', args: { command: 'auth0 api put guardian/factors/otp' }, result: '', causedError: true },
      cmd('auth0 api put guardian/policies'),
    ];
    expect(g.predicate!(calls)).toBe(false);
  });

  it('rejects non-event levels', () => {
    // @ts-expect-error — L1 is not an EventGraderLevel
    expect(() => ranCommandsInOrder(['a'], 'x', GraderLevel.L1)).toThrow('event-based graders only support');
  });
});
