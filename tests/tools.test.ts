/**
 * Tests for src/agent_eval/tools/list-files.ts and src/agent_eval/tools/write-file.ts
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ListFilesTool } from '../src/agent_eval/tools/list-files.js';
import { WriteFileTool } from '../src/agent_eval/tools/write-file.js';

function tmpDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'tools_test_')));
}

function makeContext(workspace: string) {
  return { workspace, credentials: {} };
}

// ── ListFilesTool tests ───────────────────────────────────────────────────────

describe('ListFilesTool', () => {
  it('lists workspace root when path arg is not provided', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'hello.txt'), '');
    const tool = new ListFilesTool();
    const [result] = tool.run(makeContext(dir), {});
    expect(result).toContain('(workspace root)');
    expect(result).toContain('hello.txt');
  });
});

// ── WriteFileTool tests ───────────────────────────────────────────────────────

describe('WriteFileTool', () => {
  it('throws when path is an empty string', () => {
    const tool = new WriteFileTool();
    expect(() => tool.run(makeContext(tmpDir()), { path: '', content: 'data' })).toThrow(
      'write_file requires a file path.',
    );
  });

  it('throws when path is whitespace only', () => {
    const tool = new WriteFileTool();
    expect(() => tool.run(makeContext(tmpDir()), { path: '   ', content: 'data' })).toThrow(
      'write_file requires a file path.',
    );
  });
});
