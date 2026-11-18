import { describe, it, expect } from 'vitest';
import type { EventToolCall } from '@a0/evals-graders';
import { defineGraders } from '../../../apps/auth0-evals/src/evals/organizations/cli/graders.js';

const USAGE = 'Configured application with organization_usage set to require';
const BEHAVIOR = 'Set organization_require_behavior to pre_login_prompt';

function run(...commands: string[]): EventToolCall[] {
  return commands.map((command) => ({ name: 'run_command', args: { command }, result: '', causedError: false }));
}

function passes(name: string, ...commands: string[]): boolean {
  const grader = defineGraders().find((g) => g.name === name);
  if (!grader) throw new Error(`grader not found: ${name}`);
  return grader.predicate!(run(...commands));
}

describe('organizations_cli app graders accept every valid route', () => {
  // auth0-cli v1.37.0 added dedicated flags to `apps update`; agents use them once they see `--help`.
  it('accepts the dedicated flags (the command from the audited runs)', () => {
    const c =
      'auth0 apps update i3AhiKmKTrUX5aQX6fDqwyW9xiZupOnP --organization-usage require --organization-require-behavior pre_login_prompt';
    expect(passes(USAGE, c)).toBe(true);
    expect(passes(BEHAVIOR, c)).toBe(true);
  });

  it('accepts the `=` and quoted flag spellings', () => {
    expect(passes(USAGE, 'auth0 apps update abc --organization-usage=require')).toBe(true);
    expect(passes(USAGE, 'auth0 apps update abc --organization-usage "require"')).toBe(true);
    expect(passes(USAGE, "auth0 apps update abc --organization-usage 'require'")).toBe(true);
    expect(passes(BEHAVIOR, 'auth0 apps update abc --organization-require-behavior=pre_login_prompt')).toBe(true);
  });

  it('accepts a JSON body on apps update and on the api patch passthrough', () => {
    const body = `--data '{"organization_usage":"require","organization_require_behavior":"pre_login_prompt"}'`;
    for (const c of [`auth0 apps update abc ${body}`, `auth0 api patch clients/abc ${body}`]) {
      expect(passes(USAGE, c)).toBe(true);
      expect(passes(BEHAVIOR, c)).toBe(true);
    }
  });

  // A `bash -lc "..."` wrapper (codex) escapes the quotes inside the JSON body.
  it('accepts a JSON body whose quotes are shell-escaped', () => {
    const c =
      'bash -lc "auth0 apps update abc --data \'{\\"organization_usage\\":\\"require\\",\\"organization_require_behavior\\":\\"pre_login_prompt\\"}\'"';
    expect(passes(USAGE, c)).toBe(true);
    expect(passes(BEHAVIOR, c)).toBe(true);
  });
});

describe('organizations_cli app graders still reject wrong values', () => {
  // Bare `require` also occurs inside `--organization-require-behavior`; it must not satisfy organization_usage.
  it('does not take the require-behavior flag as organization_usage=require', () => {
    expect(
      passes(
        USAGE,
        'auth0 apps update abc --organization-usage allow --organization-require-behavior pre_login_prompt',
      ),
    ).toBe(false);
  });

  it('rejects organization_usage other than require (JSON body)', () => {
    expect(
      passes(
        USAGE,
        `auth0 apps update abc --data '{"organization_usage":"deny","organization_require_behavior":"pre_login_prompt"}'`,
      ),
    ).toBe(false);
  });

  it('rejects post_login_prompt for the behavior grader', () => {
    expect(
      passes(
        BEHAVIOR,
        'auth0 apps update abc --organization-usage require --organization-require-behavior post_login_prompt',
      ),
    ).toBe(false);
  });

  it('rejects a --help probe, which changes nothing', () => {
    expect(passes(USAGE, 'auth0 apps update --help')).toBe(false);
    expect(passes(BEHAVIOR, 'auth0 apps update --help')).toBe(false);
  });

  it('rejects usage set on a different command (e.g. apps show)', () => {
    expect(passes(USAGE, 'auth0 apps show abc --organization-usage require')).toBe(false);
  });
});
