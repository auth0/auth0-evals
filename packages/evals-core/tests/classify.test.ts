import { describe, it, expect } from 'vitest';
import { classifyActionType, classifyCommandIntent } from '../src/runners/classify.js';

describe('classifyActionType', () => {
  it.each([
    ['read_file', 'Discovery'],
    ['list_files', 'Discovery'],
    ['fetch_url', 'Discovery'],
    ['search_auth0_docs', 'Discovery'],
    ['plan', 'Discovery'],
    ['write_file', 'Implementation'],
    ['finish_task', 'Implementation'],
    ['ask_user', 'Interruption'],
    ['skill', 'Skill'],
  ])('%s (no error) → %s', (name, expected) => {
    expect(classifyActionType(name, {}, false)).toBe(expected);
  });

  it('any tool with causedError → Error', () => {
    expect(classifyActionType('read_file', {}, true)).toBe('Error');
    expect(classifyActionType('plan', {}, true)).toBe('Error');
    expect(classifyActionType('write_file', {}, true)).toBe('Error');
  });

  it('mcp__ prefixed tools → Discovery', () => {
    expect(classifyActionType('mcp__auth0__search_docs', {}, false)).toBe('Discovery');
  });

  it('unknown tool → unknown', () => {
    expect(classifyActionType('some_future_tool', {}, false)).toBe('unknown');
  });

  it('run_command is classified by command intent, not tool name', () => {
    // The bug this fixes: pure-reading shell commands used to collapse into Implementation.
    expect(classifyActionType('run_command', { command: 'ls -la && cat a.md && cat b.md' }, false)).toBe('Discovery');
    expect(classifyActionType('run_command', { command: 'npm install' }, false)).toBe('Implementation');
    expect(classifyActionType('run_command', { command: 'auth0 api put "guardian/policies"' }, false)).toBe(
      'TenantConfig',
    );
  });
});

describe('classifyCommandIntent', () => {
  it.each([
    // Read-only / orientation → Discovery
    ['ls -la', 'Discovery'],
    ['cat references/setup.md', 'Discovery'],
    ['grep -r "auth0" src', 'Discovery'],
    ['head -5 package.json', 'Discovery'],
    ['sed -n "1,40p" references/mfa.md', 'Discovery'],
    ['which auth0', 'Discovery'],
    ['auth0 --version', 'Discovery'],
    ['pwd', 'Discovery'],
    ['git status', 'Discovery'],
    ['git log --oneline', 'Discovery'],
    ['git diff', 'Discovery'],
    ['npm ls', 'Discovery'],
    // Tenant reads → Discovery
    ['auth0 api get "guardian/factors"', 'Discovery'],
    ['auth0 api list', 'Discovery'],
    ['auth0 api show clients', 'Discovery'],
    // Verb-position guard: `create` inside a quoted path must not trip mutation
    ['auth0 api get "clients/create-x"', 'Discovery'],
    // Tenant writes → TenantConfig
    ['auth0 api put "guardian/policies"', 'TenantConfig'],
    ['auth0 api post clients', 'TenantConfig'],
    ['auth0 api patch "clients/abc"', 'TenantConfig'],
    ['auth0 api delete "clients/abc"', 'TenantConfig'],
    // Local mutations → Implementation
    ['npm install', 'Implementation'],
    ['npm run build', 'Implementation'],
    ['mkdir -p src/lib', 'Implementation'],
    ['rm -rf dist', 'Implementation'],
    ['sed -i "s/a/b/" file.txt', 'Implementation'],
    ['echo "x" > .env', 'Implementation'],
    ['git commit -m "wip"', 'Implementation'],
    ['git add .', 'Implementation'],
    // Unrecognised → Implementation (conservative guardrail)
    ['some_unknown_binary --flag', 'Implementation'],
  ] as [string, string][])('%j → %s', (command, expected) => {
    expect(classifyCommandIntent(command)).toBe(expected);
  });

  it('chained commands combine by precedence: tenant-write > mutation > discovery', () => {
    // Mutation anywhere in the chain wins over reads.
    expect(classifyCommandIntent('sed -n "1,5p" refs.md && npm install')).toBe('Implementation');
    // Tenant write wins over everything, including a mutation.
    expect(classifyCommandIntent('auth0 api get factors && auth0 api put factors')).toBe('TenantConfig');
    expect(classifyCommandIntent('npm install && auth0 api put factors')).toBe('TenantConfig');
    // All-reads chain stays Discovery.
    expect(classifyCommandIntent('ls | grep auth0 | head -3')).toBe('Discovery');
  });

  it('empty command → Implementation', () => {
    expect(classifyCommandIntent('')).toBe('Implementation');
  });
});
