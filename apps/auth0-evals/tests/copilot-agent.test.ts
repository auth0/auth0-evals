/**
 * Unit tests for the Copilot SDK agent runner.
 *
 * The old tests covered handleEvent/processStreamChunk — internal functions
 * from the CLI JSONL-parsing approach. Those no longer exist; event processing
 * is now wired directly to SDK session.on() handlers inside runCopilotAgent.
 *
 * This file tests the exported helpers and constants that remain unit-testable.
 */

import { describe, it, expect } from 'vitest';
import './setup-config.js';
import { COPILOT_MODEL_ID, getMcpServers } from '../src/agent_eval/runners/copilot/agent.js';

describe('COPILOT_MODEL_ID', () => {
  it('is the expected sentinel value', () => {
    expect(COPILOT_MODEL_ID).toBe('copilot');
  });
});

describe('getMcpServers', () => {
  it('returns auth0-docs remote MCP server config', () => {
    const servers = getMcpServers();
    expect(servers).toHaveProperty('auth0-docs');
    expect(servers['auth0-docs'].type).toBe('http');
    expect(servers['auth0-docs'].url).toBe('https://auth0.com/docs/mcp');
  });

  it('includes all tools via wildcard', () => {
    const servers = getMcpServers();
    expect(servers['auth0-docs'].tools).toContain('*');
  });
});
