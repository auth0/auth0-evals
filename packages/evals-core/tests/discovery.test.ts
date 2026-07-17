import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import { discoverEvals } from '../src/discovery.js';
import { EvalConfigError } from '../src/errors.js';

const createTmpDir = makeTmpDir('discovery_');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEval(base: string, category: string, name: string, frontmatter: string): void {
  const dir = join(base, 'src/evals', category, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PROMPT.md'), frontmatter);
  writeFileSync(join(dir, 'graders.ts'), 'export function defineGraders() { return []; }');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('discoverEvals', () => {
  it('throws when evalsDir does not exist', () => {
    const root = createTmpDir();
    expect(() => discoverEvals('src/evals', root)).toThrow(EvalConfigError);
  });

  it('throws when evalsDir points to a file instead of a directory', () => {
    const root = createTmpDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/evals'), 'not a directory');
    expect(() => discoverEvals('src/evals', root)).toThrow(EvalConfigError);
  });

  it('returns [] when evalsDir exists but contains no evals', () => {
    const root = createTmpDir();
    mkdirSync(join(root, 'src/evals'), { recursive: true });
    const result = discoverEvals('src/evals', root);
    expect(result).toEqual([]);
  });

  it('throws when PROMPT.md has no id in frontmatter', () => {
    const root = createTmpDir();
    makeEval(root, 'quickstarts', 'no-id', '---\nname: No ID Eval\n---\n\n## Task\nDo something.\n');

    expect(() => discoverEvals('src/evals', root)).toThrow(EvalConfigError);
  });

  it('throws when PROMPT.md has an empty id value', () => {
    const root = createTmpDir();
    makeEval(root, 'quickstarts', 'empty-id', '---\nid:\nname: Empty ID\n---\n\n## Task\nDo something.\n');

    expect(() => discoverEvals('src/evals', root)).toThrow(EvalConfigError);
  });

  it('throws when id contains invalid characters', () => {
    const root = createTmpDir();
    makeEval(root, 'quickstarts', 'bad-id', '---\nid: bad-id!@#\n---\n\n## Task\nDo something.\n');

    expect(() => discoverEvals('src/evals', root)).toThrow(EvalConfigError);
  });

  it('throws when id starts with a number', () => {
    const root = createTmpDir();
    makeEval(root, 'quickstarts', 'num', '---\nid: 123_eval\n---\n\n## Task\nDo something.\n');

    expect(() => discoverEvals('src/evals', root)).toThrow(EvalConfigError);
  });

  it('discovers evals with id in frontmatter', () => {
    const root = createTmpDir();
    makeEval(
      root,
      'quickstarts',
      'react',
      '---\nid: react_quickstart\nname: React Quickstart\n---\n\n## Task\nDo something.\n',
    );

    const result = discoverEvals('src/evals', root);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'react_quickstart',
      name: 'React Quickstart',
      category: 'quickstarts',
      path: 'src/evals/quickstarts/react',
    });
  });

  it('defaults name to id and category to parent directory', () => {
    const root = createTmpDir();
    makeEval(root, 'integrations', 'my-eval', '---\nid: my_eval\n---\n\n## Task\nDo something.\n');

    const result = discoverEvals('src/evals', root);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('my_eval');
    expect(result[0]!.category).toBe('integrations');
  });

  it('throws on duplicate eval ids', () => {
    const root = createTmpDir();
    makeEval(root, 'quickstarts', 'react-v1', '---\nid: react_quickstart\nname: React v1\n---\n\n## Task\nV1.\n');
    makeEval(root, 'quickstarts', 'react-v2', '---\nid: react_quickstart\nname: React v2\n---\n\n## Task\nV2.\n');

    expect(() => discoverEvals('src/evals', root)).toThrow(EvalConfigError);
  });

  it('returns results sorted by id', () => {
    const root = createTmpDir();
    makeEval(root, 'quickstarts', 'vue', '---\nid: vue_quickstart\n---\n\n## Task\nVue.\n');
    makeEval(root, 'quickstarts', 'angular', '---\nid: angular_quickstart\n---\n\n## Task\nAngular.\n');
    makeEval(root, 'quickstarts', 'react', '---\nid: react_quickstart\n---\n\n## Task\nReact.\n');

    const result = discoverEvals('src/evals', root);
    expect(result.map((e) => e.id)).toEqual(['angular_quickstart', 'react_quickstart', 'vue_quickstart']);
  });

  it('does not recurse into scaffold directories', () => {
    const root = createTmpDir();
    const dir = join(root, 'src/evals/quickstarts/scaffold');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'PROMPT.md'), '---\nid: scaffold_eval\n---\n\n## Task\nDo something.\n');
    writeFileSync(join(dir, 'graders.ts'), 'export function defineGraders() { return []; }');

    const result = discoverEvals('src/evals', root);
    expect(result).toEqual([]);
  });

  it('skips directories missing graders.ts', () => {
    const root = createTmpDir();
    const dir = join(root, 'src/evals/quickstarts/incomplete');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'PROMPT.md'), '---\nid: incomplete\n---\n\n## Task\nDo something.\n');
    // No graders.ts

    const result = discoverEvals('src/evals', root);
    expect(result).toEqual([]);
  });

  it('does not discover evals deeper than 3 levels below evalsDir', () => {
    const root = createTmpDir();
    // depth 0: src/evals/a, depth 1: src/evals/a/b, depth 2: src/evals/a/b/c, depth 3: src/evals/a/b/c/d
    // At depth 3 we stop recursing, so an eval at a/b/c/d/eval won't be found
    const deepDir = join(root, 'src/evals/a/b/c/d');
    mkdirSync(deepDir, { recursive: true });
    writeFileSync(join(deepDir, 'PROMPT.md'), '---\nid: deep_eval\n---\n\n## Task\nDeep.\n');
    writeFileSync(join(deepDir, 'graders.ts'), 'export function defineGraders() { return []; }');

    const result = discoverEvals('src/evals', root);
    expect(result).toEqual([]);
  });

  it('discovers evals at exactly 3 levels deep', () => {
    const root = createTmpDir();
    // depth 0: src/evals/a, depth 1: src/evals/a/b, depth 2: src/evals/a/b/c (this is level 3)
    const dir = join(root, 'src/evals/a/b/c');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'PROMPT.md'), '---\nid: level3_eval\n---\n\n## Task\nLevel 3.\n');
    writeFileSync(join(dir, 'graders.ts'), 'export function defineGraders() { return []; }');

    const result = discoverEvals('src/evals', root);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('level3_eval');
  });

  it('handles CRLF line endings in frontmatter', () => {
    const root = createTmpDir();
    const dir = join(root, 'src/evals/quickstarts/crlf');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'PROMPT.md'),
      '---\r\nid: crlf_eval\r\nname: CRLF Eval\r\n---\r\n\r\n## Task\r\nDo something.\r\n',
    );
    writeFileSync(join(dir, 'graders.ts'), 'export function defineGraders() { return []; }');

    const result = discoverEvals('src/evals', root);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('crlf_eval');
    expect(result[0]!.name).toBe('CRLF Eval');
  });
});
