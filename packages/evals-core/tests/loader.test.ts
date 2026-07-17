/**
 * Happy path tests for src/loader.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { makeTmpDir } from './tmp.js';
import { fileURLToPath } from 'node:url';
import { loadEval } from '../src/loader.js';
import { EvalConfigError, EvalNotFoundError } from '../src/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Absolute path to graders package so dynamically-created graders.ts in tmpdir can import it
const GRADERS_ABS_PATH = resolve(__dirname, '../../evals-graders/dist/index.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVAL_CONFIG = {
  id: 'my_eval',
  name: 'My Eval',
  category: 'quickstarts',
  path: 'my_eval',
};

const MINIMAL_PROMPT = '## Task\nDo the task.\n';

const DEFAULT_GRADERS = `import { contains } from '${GRADERS_ABS_PATH}';
export function defineGraders() {
  return [contains('Auth0Provider')];
}
`;

function makeEvalDir(
  base: string,
  promptText = MINIMAL_PROMPT,
  gradersText = DEFAULT_GRADERS,
  scaffoldFiles?: Record<string, string>,
): string {
  const evalDir = join(base, 'my_eval');
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, 'PROMPT.md'), promptText);
  writeFileSync(join(evalDir, 'graders.ts'), gradersText);
  if (scaffoldFiles) {
    const scaffold = join(evalDir, 'scaffold');
    mkdirSync(scaffold, { recursive: true });
    for (const [rel, content] of Object.entries(scaffoldFiles)) {
      const dest = join(scaffold, rel);
      mkdirSync(join(dest, '..'), { recursive: true });
      writeFileSync(dest, content);
    }
  }
  return evalDir;
}

const tmpDir = makeTmpDir('loader_test_');
let tmpBase: string;

beforeEach(() => {
  tmpBase = tmpDir();
});

// ── PROMPT.md parsing tests ───────────────────────────────────────────────────

describe('loadEval - PROMPT.md parsing', () => {
  it('parses frontmatter and sections', async () => {
    makeEvalDir(
      tmpBase,
      '---\nskills: auth0-react\nname: React Quickstart\n---\n\n## System\nYou are an expert React developer.\n\n## Task\nAdd Auth0 authentication to the React app.\n',
    );

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.baselineSystemPrompt).toContain('expert React developer');
    expect(result.userPrompt).toContain('Add Auth0 authentication');
    expect(result.skills).toEqual(['auth0-react']);
  });

  it('parses sections without frontmatter', async () => {
    makeEvalDir(tmpBase, '## System\nYou are a developer.\n\n## Task\nWrite some code.\n');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.baselineSystemPrompt).toContain('You are a developer');
    expect(result.userPrompt).toContain('Write some code');
    expect(result.skills).toEqual([]);
  });

  it('uses full text as task prompt without sections', async () => {
    makeEvalDir(tmpBase, 'Add Auth0 to the app.');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.baselineSystemPrompt).toContain('official Auth0 SDK');
    expect(result.userPrompt).toContain('Add Auth0 to the app');
  });

  it('exposes frontmatter in metadata', async () => {
    makeEvalDir(tmpBase, '---\nprovider_name: MyProvider\nprovider_url: example.com\n---\n\n## Task\nDo the task.\n');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.metadata.provider_name).toBe('MyProvider');
    expect(result.metadata.provider_url).toBe('example.com');
  });

  it('parses CRLF line endings correctly', async () => {
    const crlf = (s: string) => s.replace(/\n/g, '\r\n');
    makeEvalDir(
      tmpBase,
      crlf('---\nskills: auth0-react\n---\n\n## System\nYou are a developer.\n\n## Task\nAdd Auth0.\n'),
    );

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.baselineSystemPrompt).toContain('You are a developer.');
    expect(result.userPrompt).toContain('Add Auth0.');
    expect(result.skills).toEqual(['auth0-react']);
  });

  it('throws EvalConfigError with path when PROMPT.md is missing', async () => {
    const evalDir = join(tmpBase, 'my_eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(join(evalDir, 'graders.ts'), DEFAULT_GRADERS);

    const err = await loadEval(EVAL_CONFIG, tmpBase).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvalConfigError);
    expect((err as EvalConfigError).message).toContain('PROMPT.md not found');
    expect((err as EvalConfigError).message).toContain(evalDir);
  });
});

// ── setup_command frontmatter tests ──────────────────────────────────────────

describe('loadEval - setupCommand', () => {
  it('parses setup_command from frontmatter', async () => {
    makeEvalDir(tmpBase, '---\nskills: auth0-react\nsetup_command: npm install\n---\n\n## Task\nDo the task.\n');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.setupCommand).toBe('npm install');
  });

  it('returns undefined when setup_command is absent', async () => {
    makeEvalDir(tmpBase, '---\nskills: auth0-react\n---\n\n## Task\nDo the task.\n');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.setupCommand).toBeUndefined();
  });
});

// ── compile_command frontmatter tests ────────────────────────────────────────

describe('loadEval - compileCommand', () => {
  it('parses compile_command from frontmatter', async () => {
    makeEvalDir(tmpBase, '---\nskills: auth0-react\ncompile_command: npm run build\n---\n\n## Task\nDo the task.\n');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.compileCommand).toBe('npm run build');
  });

  it('returns undefined when compile_command is absent', async () => {
    makeEvalDir(tmpBase, '---\nskills: auth0-react\n---\n\n## Task\nDo the task.\n');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.compileCommand).toBeUndefined();
  });
});

// ── System prompt tests ───────────────────────────────────────────────────────

describe('loadEval - system prompt', () => {
  it('baselineSystemPrompt is parsed from ## System section', async () => {
    makeEvalDir(tmpBase, '## System\nGeneric system prompt.\n\n## Task\nDo the task.\n');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.baselineSystemPrompt).toContain('Generic system prompt');
  });
});

// ── Scaffold loading tests ────────────────────────────────────────────────────

describe('loadEval - scaffold loading', () => {
  it('loads scaffold files', async () => {
    makeEvalDir(tmpBase, MINIMAL_PROMPT, DEFAULT_GRADERS, {
      'App.js': 'const App = () => <div/>;',
      'index.js': 'ReactDOM.render(<App/>, root);',
    });

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(Object.keys(result.scaffold).length).toBe(2);
    expect(Object.keys(result.scaffold).some((k) => k.includes('App.js'))).toBe(true);
    expect(Object.values(result.scaffold).some((v) => v.includes('const App'))).toBe(true);
  });

  it('returns empty scaffold when no scaffold dir', async () => {
    makeEvalDir(tmpBase);

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.scaffold).toEqual({});
  });

  it('preserves subdirectory paths in scaffold', async () => {
    makeEvalDir(tmpBase, MINIMAL_PROMPT, DEFAULT_GRADERS, { 'src/App.js': 'app code' });

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(Object.keys(result.scaffold)).toContain('src/App.js');
    expect(result.scaffold['src/App.js']).toBe('app code');
  });

  it('loads single scaffold file correctly', async () => {
    makeEvalDir(tmpBase, MINIMAL_PROMPT, DEFAULT_GRADERS, { 'main.swift': 'import Auth0' });

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.scaffold['main.swift']).toBe('import Auth0');
  });

  it('excludes scaffold files that escape via symlink', async () => {
    // Create an eval with a normal scaffold file
    makeEvalDir(tmpBase, MINIMAL_PROMPT, DEFAULT_GRADERS, { 'safe.txt': 'ok' });

    // Create an outside directory with a secret file
    const outside = join(tmpBase, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'sensitive data');

    // Add a symlink inside the scaffold pointing outside
    const scaffoldDir = join(tmpBase, 'my_eval', 'scaffold');
    symlinkSync(outside, join(scaffoldDir, 'escaped'));

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    // The safe file should be loaded
    expect(result.scaffold['safe.txt']).toBe('ok');
    // The symlinked file should NOT be loaded (resolveInside rejects it)
    expect(result.scaffold['escaped/secret.txt']).toBeUndefined();
  });

  it('skips unreadable scaffold files and loads the rest', async () => {
    makeEvalDir(tmpBase, MINIMAL_PROMPT, DEFAULT_GRADERS, {
      'readable.txt': 'this is fine',
      'unreadable.txt': 'you cannot read me',
    });

    // Make one file unreadable
    chmodSync(join(tmpBase, 'my_eval', 'scaffold', 'unreadable.txt'), 0o000);

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.scaffold['readable.txt']).toBe('this is fine');
    expect(result.scaffold['unreadable.txt']).toBeUndefined();
  });
});

// ── frontmatter scaffold field tests ─────────────────────────────────────────

function makePromptWithScaffold(scaffoldPath: string): string {
  return `---\nid: my_eval\nname: My Eval\nscaffold: ${scaffoldPath}\n---\n\n## Task\nDo something.\n`;
}

function makeScaffoldVariant(base: string, relPath: string, files: Record<string, string>): void {
  const dir = join(base, relPath);
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, content);
  }
}

describe('loadEval - frontmatter scaffold field', () => {
  it('uses scaffold path from frontmatter', async () => {
    makeScaffoldVariant(tmpBase, 'src/evals/scaffolds/react/auth0', { 'App.jsx': 'auth0 wired' });
    const evalDir = join(tmpBase, 'my_eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(join(evalDir, 'PROMPT.md'), makePromptWithScaffold('src/evals/scaffolds/react/auth0'));
    writeFileSync(join(evalDir, 'graders.ts'), DEFAULT_GRADERS);

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.scaffold['App.jsx']).toBe('auth0 wired');
  });

  it('falls back to local scaffold/ when no scaffold field in frontmatter', async () => {
    makeEvalDir(tmpBase, MINIMAL_PROMPT, DEFAULT_GRADERS, { 'local.js': 'local scaffold' });

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.scaffold['local.js']).toBe('local scaffold');
  });

  it('throws EvalConfigError when scaffold path escapes project root', async () => {
    const evalDir = join(tmpBase, 'my_eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(join(evalDir, 'PROMPT.md'), makePromptWithScaffold('../../../etc/passwd'));
    writeFileSync(join(evalDir, 'graders.ts'), DEFAULT_GRADERS);

    const err = await loadEval(EVAL_CONFIG, tmpBase).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvalConfigError);
    expect((err as EvalConfigError).message).toContain('scaffold path is invalid');
  });

  it('throws EvalConfigError when scaffold path does not exist', async () => {
    const evalDir = join(tmpBase, 'my_eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(join(evalDir, 'PROMPT.md'), makePromptWithScaffold('scaffolds/does-not-exist'));
    writeFileSync(join(evalDir, 'graders.ts'), DEFAULT_GRADERS);

    const err = await loadEval(EVAL_CONFIG, tmpBase).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvalConfigError);
    expect((err as EvalConfigError).message).toContain('does not exist');
  });
});

// ── Graders loading tests ─────────────────────────────────────────────────────

describe('loadEval - graders loading', () => {
  it('loads graders from graders.ts', async () => {
    makeEvalDir(tmpBase);

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.graders.length).toBe(1);
    expect(result.graders[0].kind).toBe('contains');
    expect(result.graders[0].needle).toBe('Auth0Provider');
  });

  it('loads multiple graders', async () => {
    makeEvalDir(
      tmpBase,
      MINIMAL_PROMPT,
      `import { contains, matches } from '${GRADERS_ABS_PATH}';
export function defineGraders() {
  return [contains('Auth0Provider'), matches('useAuth0')];
}
`,
    );

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.graders.length).toBe(2);
    expect(new Set(result.graders.map((g) => g.kind))).toEqual(new Set(['contains', 'matches']));
  });

  it('throws EvalConfigError with path when graders.ts is missing', async () => {
    const evalDir = join(tmpBase, 'my_eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(join(evalDir, 'PROMPT.md'), MINIMAL_PROMPT);

    const err = await loadEval(EVAL_CONFIG, tmpBase).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvalConfigError);
    expect((err as EvalConfigError).message).toContain('graders file not found');
    expect((err as EvalConfigError).message).toContain(evalDir);
  });

  it('throws EvalConfigError with path when defineGraders is missing from graders.ts', async () => {
    const evalDir = makeEvalDir(tmpBase, MINIMAL_PROMPT, '// no defineGraders function here\n');

    const err = await loadEval(EVAL_CONFIG, tmpBase).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvalConfigError);
    expect((err as EvalConfigError).message).toContain('graders.ts missing defineGraders()');
    expect((err as EvalConfigError).message).toContain(evalDir);
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────

describe('loadEval - integration', () => {
  it('returns a fully populated EvalDefinition', async () => {
    const evalDir = join(tmpBase, 'my_eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(
      join(evalDir, 'PROMPT.md'),
      '---\nskills: auth0-react\nname: My Eval\nprovider_name: Auth0\n---\n\n## System\nYou are an expert.\n\n## Task\nAdd authentication.\n',
    );
    writeFileSync(join(evalDir, 'graders.ts'), DEFAULT_GRADERS);
    const scaffoldDir = join(evalDir, 'scaffold');
    mkdirSync(scaffoldDir, { recursive: true });
    writeFileSync(join(scaffoldDir, 'App.js'), '// starter');

    const result = await loadEval(EVAL_CONFIG, tmpBase);

    expect(result.id).toBe('my_eval');
    expect(result.name).toBe('My Eval');
    expect(result.graders.length).toBe(1);
    expect(result.graders[0].kind).toBe('contains');
    expect('App.js' in result.scaffold).toBe(true);
    expect(result.skills).toEqual(['auth0-react']);
  });

  it('throws EvalNotFoundError when eval directory is missing', async () => {
    const evalConfig = { id: 'nonexistent', name: 'None', category: 'x', path: 'nonexistent' };
    const err = await loadEval(evalConfig, tmpBase).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvalNotFoundError);
    expect((err as EvalNotFoundError).message).toContain('nonexistent');
  });
});
