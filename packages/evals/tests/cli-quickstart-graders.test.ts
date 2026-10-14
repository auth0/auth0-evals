import { describe, it, expect } from 'vitest';
import type { EventToolCall, GraderDef } from '@a0/evals-graders';
import { defineGraders as spa } from '../../../apps/auth0-evals/src/evals/quickstarts/cli-spa/graders.js';
import { defineGraders as regular } from '../../../apps/auth0-evals/src/evals/quickstarts/cli-regular-web/graders.js';
import { defineGraders as native } from '../../../apps/auth0-evals/src/evals/quickstarts/cli-native/graders.js';

function cmd(command: string): EventToolCall[] {
  return [{ name: 'run_command', args: { command }, result: '', causedError: false }];
}

function eventResults(graders: GraderDef[], command: string): Record<string, boolean> {
  const calls = cmd(command);
  return Object.fromEntries(graders.filter((g) => g.kind === 'event').map((g) => [g.name, g.predicate!(calls)]));
}

const L4_REGULAR = [
  'Created a Regular Web Application',
  'Configured the local dev callback URL',
  'Configured the local dev logout URL',
];

describe('cli quickstart graders', () => {
  it('has no grant-flag grader', () => {
    for (const defs of [spa(), regular(), native()]) {
      expect(defs.some((g) => g.name.includes('Explicitly configured'))).toBe(false);
    }
  });

  it('passes all SPA L4 graders for apps create without --grants', () => {
    const r = eventResults(
      spa(),
      'auth0 apps create --name "Quickstart SPA" --type spa --callbacks http://localhost:3000 --logout-urls http://localhost:3000 --web-origins http://localhost:3000',
    );
    expect(r['Created a SPA application']).toBe(true);
    expect(r['Configured the local dev callback URL']).toBe(true);
    expect(r['Configured the local dev logout URL']).toBe(true);
    expect(r['Configured the allowed web origin']).toBe(true);
  });

  it('passes native L4 graders for apps create without --grants', () => {
    const r = eventResults(
      native(),
      'auth0 apps create --name "Quickstart Native" --type native --callbacks com.example.quickstart://cb --logout-urls com.example.quickstart://cb',
    );
    expect(Object.values(r).filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  it('accepts qs setup for the regular-web create/callback/logout graders', () => {
    const r = eventResults(
      regular(),
      'auth0 qs setup --type regular --name "Quickstart Web App" --callback-url http://localhost:3000/callback --logout-url http://localhost:3000',
    );
    for (const name of L4_REGULAR) expect(r[name]).toBe(true);
  });

  it('accepts apps create for the regular-web create/callback/logout graders', () => {
    const r = eventResults(
      regular(),
      'auth0 apps create --name "Quickstart Web App" --type regular --callbacks "http://localhost:3000/callback" --logout-urls "http://localhost:3000"',
    );
    for (const name of L4_REGULAR) expect(r[name]).toBe(true);
  });

  it('accepts the raw api post clients route for the regular-web create grader', () => {
    const r = eventResults(regular(), `auth0 api post clients --data '{"app_type":"regular_web"}'`);
    expect(r['Created a Regular Web Application']).toBe(true);
  });

  it('rejects swapped or missing callback/logout flags for regular-web', () => {
    const swapped = eventResults(
      regular(),
      'auth0 apps create --type regular --callbacks http://localhost:3000 --logout-urls http://localhost:3000/callback',
    );
    expect(swapped['Configured the local dev callback URL']).toBe(false);
    const missing = eventResults(
      regular(),
      'auth0 qs setup --type regular --callback-url http://localhost:3000/callback',
    );
    expect(missing['Configured the local dev callback URL']).toBe(true);
    expect(missing['Configured the local dev logout URL']).toBe(false);
  });

  it('rejects a logout URL that is the callback URL for regular-web', () => {
    const qs = eventResults(
      regular(),
      'auth0 qs setup --type regular --callback-url http://localhost:3000/callback --logout-url http://localhost:3000/callback',
    );
    expect(qs['Configured the local dev callback URL']).toBe(true);
    expect(qs['Configured the local dev logout URL']).toBe(false);
    const create = eventResults(
      regular(),
      'auth0 apps create --type regular --callbacks http://localhost:3000/callback --logout-urls http://localhost:3000/callback',
    );
    expect(create['Configured the local dev logout URL']).toBe(false);
    const ok = eventResults(
      regular(),
      'auth0 apps create --type regular --callbacks http://localhost:3000/callback --logout-urls http://localhost:3000',
    );
    expect(ok['Configured the local dev callback URL']).toBe(true);
    expect(ok['Configured the local dev logout URL']).toBe(true);
  });

  it('does not accept qs setup for SPA graders', () => {
    const r = eventResults(
      spa(),
      'auth0 qs setup --type spa --callback-url http://localhost:3000 --logout-url http://localhost:3000 --web-origin-url http://localhost:3000',
    );
    for (const v of Object.values(r).filter((_, i) => i < 4)) expect(v).toBe(false);
  });

  it('does not accept qs setup for native graders', () => {
    const r = eventResults(
      native(),
      'auth0 qs setup --type native --callback-url com.example.quickstart://cb --logout-url com.example.quickstart://cb',
    );
    expect(r['Created a Native application']).toBe(false);
    expect(r['Registered the custom-scheme callback URL']).toBe(false);
    expect(r['Registered the custom-scheme logout URL']).toBe(false);
  });

  it('still fails on wrong flag values or wrong type', () => {
    const r = eventResults(
      regular(),
      'auth0 qs setup --type spa --callback-url http://other.com/callback --logout-url http://other.com',
    );
    expect(r['Created a Regular Web Application']).toBe(false);
    expect(r['Configured the local dev callback URL']).toBe(false);
    expect(r['Configured the local dev logout URL']).toBe(false);
  });
});
