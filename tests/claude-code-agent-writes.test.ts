/**
 * Tests for writeAgentSystemPrompt and writeMcpConfig helpers.
 *
 * Both functions are pure I/O helpers that write files into a workspace
 * directory.  Tests use a real temp directory so no mocking is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAgentSystemPrompt, writeMcpConfig } from '../src/agent_eval/runners/claude-code/agent.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'cc_writes_test_'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── writeAgentSystemPrompt ────────────────────────────────────────────────────

describe('writeAgentSystemPrompt', () => {
  it('writes CLAUDE.md with the provided prompt', () => {
    const prompt = '# Task\nAlways use the Auth0 SDK.';
    writeAgentSystemPrompt(workspace, prompt);

    const claudeMdPath = join(workspace, 'CLAUDE.md');
    expect(existsSync(claudeMdPath)).toBe(true);
    expect(readFileSync(claudeMdPath, 'utf-8')).toBe(prompt);
  });

  it('does not create CLAUDE.md when prompt is an empty string', () => {
    writeAgentSystemPrompt(workspace, '');

    const claudeMdPath = join(workspace, 'CLAUDE.md');
    expect(existsSync(claudeMdPath)).toBe(false);
  });

  it('overwrites an existing CLAUDE.md', () => {
    writeAgentSystemPrompt(workspace, 'original content');
    writeAgentSystemPrompt(workspace, 'updated content');

    expect(readFileSync(join(workspace, 'CLAUDE.md'), 'utf-8')).toBe('updated content');
  });

  it('preserves multi-line prompt content exactly', () => {
    const prompt = '# Header\n\nLine 1\nLine 2\n\n## Section\n- bullet';
    writeAgentSystemPrompt(workspace, prompt);
    expect(readFileSync(join(workspace, 'CLAUDE.md'), 'utf-8')).toBe(prompt);
  });
});

// ── writeMcpConfig ────────────────────────────────────────────────────────────

describe('writeMcpConfig', () => {
  it('returns the absolute path to the config file', () => {
    const result = writeMcpConfig(workspace);
    expect(result).toBe(join(workspace, '.mcp-config.json'));
  });

  it('creates the config file at the returned path', () => {
    const path = writeMcpConfig(workspace);
    expect(existsSync(path)).toBe(true);
  });

  it('writes valid JSON', () => {
    const path = writeMcpConfig(workspace);
    const raw = readFileSync(path, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('contains the auth0-docs MCP server entry', () => {
    const path = writeMcpConfig(workspace);
    const config = JSON.parse(readFileSync(path, 'utf-8')) as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    expect(config).toHaveProperty('mcpServers');
    expect(config.mcpServers).toHaveProperty('auth0-docs');
    expect(config.mcpServers['auth0-docs'].type).toBe('http');
    expect(config.mcpServers['auth0-docs'].url).toBe('https://auth0.com/docs/mcp');
  });

  it('is idempotent — calling twice yields the same content', () => {
    const path1 = writeMcpConfig(workspace);
    const content1 = readFileSync(path1, 'utf-8');
    const path2 = writeMcpConfig(workspace);
    const content2 = readFileSync(path2, 'utf-8');
    expect(content1).toBe(content2);
  });
});
