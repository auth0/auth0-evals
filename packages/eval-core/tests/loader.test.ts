import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import { loadEval } from '../src/loader.js';

const tmpDir = makeTmpDir('loader_test_');

describe('loadEval — runtime frontmatter', () => {
  it('parses serve_command, serve_port, and runtime_swap', async () => {
    const root = tmpDir();
    const evalDir = join(root, 'src/evals/demo');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(
      join(evalDir, 'PROMPT.md'),
      [
        '---',
        'id: demo',
        'name: Demo',
        'serve_command: npm run dev',
        'serve_port: 5173',
        'runtime_swap: fake.auth0.com=$RUNTIME_AUTH0_DOMAIN',
        '---',
        '',
        '## Task',
        'Do the thing.',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(evalDir, 'graders.ts'),
      'export function defineGraders() { return []; }\n',
    );

    const def = await loadEval(
      { id: 'demo', name: 'Demo', category: 'demo', path: 'src/evals/demo' },
      root,
    );
    expect(def.serveCommand).toBe('npm run dev');
    expect(def.servePort).toBe(5173);
    expect(def.runtimeSwap).toBe('fake.auth0.com=$RUNTIME_AUTH0_DOMAIN');
  });

  it('leaves fields undefined when frontmatter omits them', async () => {
    const root = tmpDir();
    const evalDir = join(root, 'src/evals/demo2');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(
      join(evalDir, 'PROMPT.md'),
      ['---', 'id: demo2', 'name: Demo2', '---', '', '## Task', 'x', ''].join('\n'),
    );
    writeFileSync(
      join(evalDir, 'graders.ts'),
      'export function defineGraders() { return []; }\n',
    );

    const def = await loadEval(
      { id: 'demo2', name: 'Demo2', category: 'demo', path: 'src/evals/demo2' },
      root,
    );
    expect(def.serveCommand).toBeUndefined();
    expect(def.servePort).toBeUndefined();
    expect(def.runtimeSwap).toBeUndefined();
  });
});
