/**
 * Tests for writeAgentSystemPrompt helper.
 *
 * The function is a pure I/O helper that writes a file into a workspace
 * directory. Tests use a real temp directory so no mocking is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAgentSystemPrompt } from '../src/agent_eval/runners/claude-code/agent.js';

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
