import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraderLevel } from '@a0/evals-graders';
import type { GraderDef, CompileResult } from '@a0/evals-graders';
import { containsExecutor } from '../../src/graders/executors/contains.js';
import { notContainsExecutor } from '../../src/graders/executors/not-contains.js';
import { notContainsInSourceExecutor } from '../../src/graders/executors/not-contains-in-source.js';
import { matchesExecutor } from '../../src/graders/executors/matches.js';
import { isJudgeExcluded, formatCommandTrace, llmJudgeExecutor } from '../../src/graders/executors/llm-judge.js';
import type { EventToolCall } from '@a0/evals-graders';
import { compileExecutor } from '../../src/graders/executors/compile.js';
import type { GraderContext } from '../../src/graders/executors/types.js';

// Mock the underlying judge LLM call so the executor tests exercise the
// includeCommandTrace gate without hitting the network. The mock records the
// `code` it was handed so tests can assert on what the executor sent.
const llmJudgeMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/graders/llm-judge.js', () => ({
  llmJudge: llmJudgeMock,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(files: Record<string, string>): GraderContext {
  const combinedText = Object.entries(files)
    .map(([path, content]) => `// FILE: ${path}\n${content}`)
    .join('\n\n');
  return {
    workspace: '/tmp/test',
    files,
    combinedText,
    combinedLower: combinedText.toLowerCase(),
  };
}

function makeDef(overrides: Partial<GraderDef> & { kind: string }): GraderDef {
  return { name: 'test grader', ...overrides };
}

// ── contains ──────────────────────────────────────────────────────────────────

describe('containsExecutor', () => {
  it('passes when needle is present in workspace files', async () => {
    const ctx = makeCtx({ 'app.ts': "import { Auth0Provider } from '@auth0/auth0-react';" });
    const def = makeDef({ kind: 'contains', needle: 'Auth0Provider', level: GraderLevel.L1 });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("'Auth0Provider' found in written files");
  });

  it('fails when needle is not present', async () => {
    const ctx = makeCtx({ 'app.ts': 'console.log("hello")' });
    const def = makeDef({ kind: 'contains', needle: 'Auth0Provider' });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('NOT found');
  });

  it('is case-sensitive by default', async () => {
    const ctx = makeCtx({ 'app.ts': 'auth0provider' });
    const def = makeDef({ kind: 'contains', needle: 'Auth0Provider' });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('supports case-insensitive search', async () => {
    const ctx = makeCtx({ 'app.ts': 'auth0provider' });
    const def = makeDef({ kind: 'contains', needle: 'Auth0Provider', caseSensitive: false });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('searches across multiple files', async () => {
    const ctx = makeCtx({ 'a.ts': 'foo', 'b.ts': 'bar', 'c.ts': 'baz' });
    const def = makeDef({ kind: 'contains', needle: 'bar' });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('preserves grader metadata in result', async () => {
    const ctx = makeCtx({ 'app.ts': 'Auth0Provider' });
    const def = makeDef({
      kind: 'contains',
      needle: 'Auth0Provider',
      name: 'has Auth0Provider',
      level: GraderLevel.L1,
    });
    const result = await containsExecutor.execute(def, ctx);
    expect(result.name).toBe('has Auth0Provider');
    expect(result.kind).toBe('contains');
    expect(result.level).toBe(GraderLevel.L1);
  });
});

// ── not_contains ──────────────────────────────────────────────────────────────

describe('notContainsExecutor', () => {
  it('passes when needle is absent from workspace files', async () => {
    const ctx = makeCtx({ 'app.ts': "import { useAuth0 } from '@auth0/auth0-react';" });
    const def = makeDef({ kind: 'not_contains', needle: 'fake-package' });
    const result = await notContainsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('NOT found (good)');
  });

  it('fails when needle is present', async () => {
    const ctx = makeCtx({ 'app.ts': "import fake from 'fake-package';" });
    const def = makeDef({ kind: 'not_contains', needle: 'fake-package' });
    const result = await notContainsExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('FOUND (bad)');
  });

  it('is case-sensitive by default', async () => {
    const ctx = makeCtx({ 'app.ts': 'FAKE-PACKAGE' });
    const def = makeDef({ kind: 'not_contains', needle: 'fake-package' });
    const result = await notContainsExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('supports case-insensitive search', async () => {
    const ctx = makeCtx({ 'app.ts': 'FAKE-PACKAGE' });
    const def = makeDef({ kind: 'not_contains', needle: 'fake-package', caseSensitive: false });
    const result = await notContainsExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });
});

// ── not_contains_in_source ────────────────────────────────────────────────────

describe('notContainsInSourceExecutor', () => {
  it('passes when needle is absent from source files', async () => {
    const ctx = makeCtx({ 'app.ts': 'const x = 1;' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('fails when needle is found in a source file', async () => {
    const ctx = makeCtx({ 'app.ts': 'const secret = "MY_SECRET";' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('allows needle in config files (.env)', async () => {
    const ctx = makeCtx({ '.env': 'AUTH0_SECRET=MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .json config files', async () => {
    const ctx = makeCtx({ 'config.json': '{"secret": "MY_SECRET"}' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .yaml config files', async () => {
    const ctx = makeCtx({ 'config.yaml': 'secret: MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .yml config files', async () => {
    const ctx = makeCtx({ 'config.yml': 'secret: MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .env.local files', async () => {
    const ctx = makeCtx({ '.env.local': 'SECRET=MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in .toml config files', async () => {
    const ctx = makeCtx({ 'config.toml': 'secret = "MY_SECRET"' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('fails when needle is in source but passes for config — mixed files', async () => {
    const ctx = makeCtx({
      '.env': 'SECRET=MY_SECRET',
      'app.ts': 'const secret = "MY_SECRET";',
    });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('passes when needle is only in config — mixed files', async () => {
    const ctx = makeCtx({
      '.env': 'SECRET=MY_SECRET',
      'app.ts': 'const x = process.env.SECRET;',
    });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('is case-sensitive by default', async () => {
    const ctx = makeCtx({ 'app.ts': 'my_secret' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('supports case-insensitive search', async () => {
    const ctx = makeCtx({ 'app.ts': 'my_secret' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET', caseSensitive: false });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('handles nested path correctly — extracts basename', async () => {
    const ctx = makeCtx({ 'src/config/settings.json': '{"key": "MY_SECRET"}' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it.each(['.plist', '.xml', '.ini', '.cfg', '.conf'])('allows needle in %s config files', async (ext) => {
    const ctx = makeCtx({ [`config${ext}`]: 'secret: MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('allows needle in nested .env.production files via prefix match', async () => {
    const ctx = makeCtx({ 'config/.env.production': 'SECRET=MY_SECRET' });
    const def = makeDef({ kind: 'not_contains_in_source', needle: 'MY_SECRET' });
    const result = await notContainsInSourceExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });
});

// ── matches ───────────────────────────────────────────────────────────────────

describe('matchesExecutor', () => {
  it('passes when regex pattern matches workspace content', async () => {
    const ctx = makeCtx({ 'app.ts': "import { useAuth0 } from '@auth0/auth0-react';" });
    const def = makeDef({ kind: 'matches', pattern: 'useAuth0' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('matched');
  });

  it('fails when regex pattern does not match', async () => {
    const ctx = makeCtx({ 'app.ts': 'console.log("hello")' });
    const def = makeDef({ kind: 'matches', pattern: 'useAuth0' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('NOT matched');
  });

  it('supports regex syntax', async () => {
    const ctx = makeCtx({ 'app.ts': 'const clientId = "abc123";' });
    const def = makeDef({ kind: 'matches', pattern: 'clientId\\s*=\\s*"[a-z0-9]+"' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('uses case-insensitive and multiline flags by default', async () => {
    const ctx = makeCtx({ 'app.ts': 'AUTH0PROVIDER' });
    const def = makeDef({ kind: 'matches', pattern: 'auth0provider' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('honors caseSensitive: true (does not match differing case)', async () => {
    const ctx = makeCtx({ 'app.ts': 'AUTH0PROVIDER' });
    const def = makeDef({ kind: 'matches', pattern: 'auth0provider', caseSensitive: true });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
  });

  it('caseSensitive: true still matches exact case', async () => {
    const ctx = makeCtx({ 'app.ts': 'Auth0Provider' });
    const def = makeDef({ kind: 'matches', pattern: 'Auth0Provider', caseSensitive: true });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });

  it('handles invalid regex gracefully', async () => {
    const ctx = makeCtx({ 'app.ts': 'some content' });
    const def = makeDef({ kind: 'matches', pattern: '[invalid(' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('invalid regex');
  });

  it('matches across multiple lines', async () => {
    const ctx = makeCtx({ 'app.ts': 'line1\nline2\nAuth0Provider\nline4' });
    const def = makeDef({ kind: 'matches', pattern: '^Auth0Provider$' });
    const result = await matchesExecutor.execute(def, ctx);
    expect(result.passed).toBe(true);
  });
});

// ── isJudgeExcluded ─────────────────────────────────────────────────────────

describe('isJudgeExcluded', () => {
  it('excludes tsconfig variants by basename', () => {
    expect(isJudgeExcluded('tsconfig.json')).toBe(true);
    expect(isJudgeExcluded('tsconfig.app.json')).toBe(true);
    expect(isJudgeExcluded('tsconfig.tsbuildinfo')).toBe(true);
    expect(isJudgeExcluded('src/tsconfig.json')).toBe(true);
  });

  it('excludes angular.json by basename', () => {
    expect(isJudgeExcluded('angular.json')).toBe(true);
  });

  it('excludes the .gradle directory and its contents', () => {
    expect(isJudgeExcluded('.gradle')).toBe(true);
    expect(isJudgeExcluded('.gradle/caches/file.bin')).toBe(true);
  });

  it('excludes the app/build directory and its contents', () => {
    expect(isJudgeExcluded('app/build')).toBe(true);
    expect(isJudgeExcluded('app/build/outputs/apk/app.apk')).toBe(true);
  });

  it('excludes .env so credential values never reach the judge', () => {
    expect(isJudgeExcluded('.env')).toBe(true);
  });

  it('excludes .env variants (.env.local, .env.production) including nested', () => {
    expect(isJudgeExcluded('.env.local')).toBe(true);
    expect(isJudgeExcluded('.env.production')).toBe(true);
    expect(isJudgeExcluded('config/.env.staging')).toBe(true);
  });

  it('does not exclude source files', () => {
    expect(isJudgeExcluded('app/src/main/MainActivity.kt')).toBe(false);
    expect(isJudgeExcluded('src/index.ts')).toBe(false);
    expect(isJudgeExcluded('build.gradle.kts')).toBe(false);
  });

  it('does not exclude files that merely contain "env" in the name', () => {
    expect(isJudgeExcluded('environment.ts')).toBe(false);
    expect(isJudgeExcluded('src/env.config.ts')).toBe(false);
  });

  it('does not exclude paths that merely contain the excluded dir name as a prefix', () => {
    expect(isJudgeExcluded('app/build-config.json')).toBe(false);
    expect(isJudgeExcluded('.gradle-wrapper/file')).toBe(false);
  });

  it('excludes markdown files', () => {
    expect(isJudgeExcluded('README.md')).toBe(true);
    expect(isJudgeExcluded('docs/SETUP.md')).toBe(true);
    expect(isJudgeExcluded('CHANGELOG.MD')).toBe(true);
  });

  it('excludes text files (agent-emitted docs, summaries, checklists)', () => {
    expect(isJudgeExcluded('IMPLEMENTATION_SUMMARY.txt')).toBe(true);
    expect(isJudgeExcluded('docs/VERIFICATION_CHECKLIST.txt')).toBe(true);
    expect(isJudgeExcluded('NOTES.TXT')).toBe(true);
  });

  it('excludes binaries the workspace walker would otherwise read as mojibake', () => {
    expect(isJudgeExcluded('android/gradle/wrapper/gradle-wrapper.jar')).toBe(true);
    expect(isJudgeExcluded('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png')).toBe(true);
    expect(isJudgeExcluded('android/app/debug.keystore')).toBe(true);
    expect(isJudgeExcluded('assets/fonts/Inter.ttf')).toBe(true);
  });

  it('excludes generated native project files', () => {
    expect(isJudgeExcluded('ios/scaffold.xcodeproj/project.pbxproj')).toBe(true);
    expect(isJudgeExcluded('ios/scaffold/LaunchScreen.storyboard')).toBe(true);
    expect(isJudgeExcluded('ios/Podfile.lock')).toBe(true);
    expect(isJudgeExcluded('android/gradlew')).toBe(true);
    expect(isJudgeExcluded('android/gradlew.bat')).toBe(true);
  });

  it('keeps the native config files judges assert on', () => {
    expect(isJudgeExcluded('ios/scaffold/Info.plist')).toBe(false);
    expect(isJudgeExcluded('android/app/build.gradle')).toBe(false);
    expect(isJudgeExcluded('android/app/src/main/AndroidManifest.xml')).toBe(false);
    expect(isJudgeExcluded('ios/Podfile')).toBe(false);
  });
});

// ── formatCommandTrace ──────────────────────────────────────────────────────

describe('formatCommandTrace', () => {
  const cmd = (command: string, causedError = false): EventToolCall => ({
    name: 'run_command',
    args: { command },
    result: '',
    causedError,
  });

  it('renders successful shell commands under a labelled header', () => {
    const out = formatCommandTrace([
      cmd('auth0 api put guardian/factors/otp --data \'{"enabled":true}\''),
      cmd('auth0 api put guardian/policies --data \'["all-applications"]\''),
    ]);
    expect(out).toContain('// COMMAND TRACE');
    expect(out).toContain('guardian/factors/otp');
    expect(out).toContain('guardian/policies');
  });

  it('accepts the bash tool name as a shell command', () => {
    const out = formatCommandTrace([
      { name: 'bash', args: { command: 'auth0 api get guardian/factors' }, result: '', causedError: false },
    ]);
    expect(out).toContain('guardian/factors');
  });

  it('drops errored commands so the judge sees only what took effect', () => {
    const out = formatCommandTrace([cmd('auth0 login', true), cmd('auth0 api put guardian/policies')]);
    expect(out).not.toContain('auth0 login');
    expect(out).toContain('guardian/policies');
  });

  it('ignores non-shell tool calls', () => {
    const out = formatCommandTrace([
      { name: 'write_file', args: { path: 'x.ts', content: 'y' }, result: '', causedError: false },
    ]);
    expect(out).toBe('');
  });

  it('returns an empty string when there are no commands', () => {
    expect(formatCommandTrace([])).toBe('');
  });

  it('masks credential values, leaving the marker for a security judge to read', () => {
    // The trace is sent to the judge model, so a secret on a command line would leave
    // the machine. The marker stays in place of the value, so a security judge can
    // still see that a secret occupied that position.
    const out = formatCommandTrace([
      cmd('auth0 api post clients --client-secret fixture_not_a_real_secret_abcdef0123456789'),
    ]);
    expect(out).not.toContain('fixture_not_a_real_secret_abcdef0123456789');
    expect(out).toContain('[REDACTED SECRET]');
    expect(out).toContain('auth0 api post clients');
  });
});

// ── llmJudgeExecutor: includeCommandTrace gate ───────────────────────────────

describe('llmJudgeExecutor — includeCommandTrace gate', () => {
  const JUDGE_CTX = {
    model: 'claude-opus-5',
    baseUrl: 'https://proxy.example',
    maxTokens: 4096,
    maxCodeChars: 32768,
    enforceMaxChars: false,
  };

  function judgeCtx(files: Record<string, string>, toolCalls: EventToolCall[]): GraderContext {
    return { ...makeCtx(files), apiKey: 'test-key', judge: JUDGE_CTX, toolCalls };
  }

  const trace: EventToolCall[] = [
    { name: 'run_command', args: { command: 'auth0 api put guardian/policies' }, result: '', causedError: false },
  ];

  beforeEach(() => {
    llmJudgeMock.mockReset();
    llmJudgeMock.mockResolvedValue({ passed: true, detail: 'ok', inputTokens: 1, outputTokens: 1 });
  });

  it('appends the command trace to the judge input when includeCommandTrace is true', async () => {
    const def = makeDef({ kind: 'judge', question: 'Did the CLI enforce MFA?', includeCommandTrace: true });
    await llmJudgeExecutor.execute(def, judgeCtx({ 'app.ts': 'console.log(1)' }, trace));

    expect(llmJudgeMock).toHaveBeenCalledOnce();
    const { code } = llmJudgeMock.mock.calls[0][0];
    expect(code).toContain('// COMMAND TRACE');
    expect(code).toContain('auth0 api put guardian/policies');
  });

  it('omits the command trace when includeCommandTrace is false', async () => {
    const def = makeDef({ kind: 'judge', question: 'Is this correct?', includeCommandTrace: false });
    await llmJudgeExecutor.execute(def, judgeCtx({ 'app.ts': 'console.log(1)' }, trace));

    const { code } = llmJudgeMock.mock.calls[0][0];
    expect(code).not.toContain('// COMMAND TRACE');
    expect(code).not.toContain('guardian/policies');
    expect(code).toContain('app.ts');
  });

  it('omits the command trace when the flag is unset (default behaviour)', async () => {
    const def = makeDef({ kind: 'judge', question: 'Is this correct?' });
    await llmJudgeExecutor.execute(def, judgeCtx({ 'app.ts': 'console.log(1)' }, trace));

    const { code } = llmJudgeMock.mock.calls[0][0];
    expect(code).not.toContain('// COMMAND TRACE');
  });
});

// ── compile ───────────────────────────────────────────────────────────────────

describe('compile executor', () => {
  it('passes when compileResult.ok is true', async () => {
    const def = makeDef({ kind: 'compile', level: GraderLevel.L4 });
    const compileResult: CompileResult = {
      ok: true,
      exitCode: 0,
      signal: null,
      output: 'done',
      command: 'npm run build',
    };
    const res = await compileExecutor.execute(def, { ...makeCtx({}), compileResult });
    expect(res.passed).toBe(true);
    expect(res.kind).toBe('compile');
  });

  it('fails when compileResult.ok is false and includes exit code + output tail in detail', async () => {
    const def = makeDef({ kind: 'compile', level: GraderLevel.L4 });
    const compileResult: CompileResult = {
      ok: false,
      exitCode: 2,
      signal: null,
      output: 'TS2304: Cannot find name foo',
      command: 'npm run build',
    };
    const res = await compileExecutor.execute(def, { ...makeCtx({}), compileResult });
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('2');
    expect(res.detail).toContain('TS2304');
  });

  it('fails when no compileResult is present (eval misconfigured)', async () => {
    const def = makeDef({ kind: 'compile', level: GraderLevel.L4 });
    const res = await compileExecutor.execute(def, makeCtx({}));
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('compile was not run');
  });
});
