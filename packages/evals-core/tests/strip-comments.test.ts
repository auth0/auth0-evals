/**
 * Tests for stripComments (executors/text-search-utils.ts) and the
 * ignoreComments path in searchCorpus.
 */

import { describe, it, expect } from 'vitest';
import { stripComments } from '../src/graders/executors/text-search-utils.js';
import { searchCorpus } from '../src/graders/executors/search-corpus.js';
import type { GraderContext } from '../src/graders/executors/types.js';

describe('stripComments', () => {
  it('removes // line comments but keeps the same token in a string literal', () => {
    const kt = `val url = "https://x/mfa/challenge" // no separate /mfa/challenge here`;
    const out = stripComments(kt, 'MainActivity.kt');
    expect(out).toContain('"https://x/mfa/challenge"'); // string preserved
    expect(out).not.toContain('no separate'); // comment text gone
    expect(out.split('mfa/challenge').length - 1).toBe(1); // only the string copy remains
  });

  it('removes /* block */ comments', () => {
    const js = `const a = 1; /* call /mfa/challenge directly */ const b = 2;`;
    expect(stripComments(js, 'app.js')).not.toContain('mfa/challenge');
  });

  it('does not treat // inside a string as a comment', () => {
    const js = `const u = "http://host//mfa/challenge";`;
    expect(stripComments(js, 'app.ts')).toContain('http://host//mfa/challenge');
  });

  it('handles escaped quotes inside strings', () => {
    const js = String.raw`const s = "a \" // still string /mfa/challenge"; // real comment`;
    const out = stripComments(js, 'app.js');
    expect(out).toContain('/mfa/challenge'); // it was inside the string
  });

  it('strips # comments in python but keeps strings', () => {
    const py = `URL = "/mfa/challenge"  # do not hand-roll /mfa/challenge`;
    const out = stripComments(py, 'client.py');
    expect(out).toContain('"/mfa/challenge"');
    expect(out.slice(out.indexOf('#'))).not.toContain('mfa/challenge');
  });

  it('preserves triple-quoted strings', () => {
    const py = `DOC = """see /mfa/challenge"""`;
    expect(stripComments(py, 'client.py')).toContain('/mfa/challenge');
  });

  it('returns content unchanged for unknown extensions', () => {
    const txt = `anything // /mfa/challenge`;
    expect(stripComments(txt, 'notes.unknownext')).toBe(txt);
  });

  it('returns shell content unchanged (sh/bash/zsh not stripped due to $# ambiguity)', () => {
    const sh = `echo $# # /mfa/challenge`;
    expect(stripComments(sh, 'setup.sh')).toBe(sh);
    expect(stripComments(sh, 'run.bash')).toBe(sh);
    expect(stripComments(sh, 'run.zsh')).toBe(sh);
  });

  it('handles nested Kotlin block comments correctly', () => {
    // outer comment contains inner comment plus the needle — all should be stripped
    const kt = `/* outer /* inner */ /mfa/challenge */ val real = mfaClient(token)`;
    const out = stripComments(kt, 'Api.kt');
    expect(out).not.toContain('mfa/challenge');
    expect(out).toContain('mfaClient');
  });

  it('handles nested Swift block comments correctly', () => {
    const swift = `/* outer /* inner /mfa/challenge */ still-outer */ let x = 1`;
    const out = stripComments(swift, 'Auth.swift');
    expect(out).not.toContain('mfa/challenge');
    expect(out).toContain('let x');
  });
});

function ctxFrom(files: Record<string, string>): GraderContext {
  const combinedText = Object.entries(files)
    .map(([k, v]) => `// FILE: ${k}\n${v}`)
    .join('\n\n');
  return {
    workspace: '/tmp/x',
    files,
    combinedText,
    combinedLower: combinedText.toLowerCase(),
    agentText: '',
  } as GraderContext;
}

describe('searchCorpus ignoreComments', () => {
  const files = { 'MainActivity.kt': `// needs no separate /mfa/challenge step\nval c = mfaClient(token)` };

  it('finds the needle in raw text when ignoreComments is false', () => {
    expect(searchCorpus(ctxFrom(files), 'mfa/challenge', true, 'files', false).inFiles).toBe(true);
  });

  it('does not find a needle that lives only in a comment when ignoreComments is true', () => {
    expect(searchCorpus(ctxFrom(files), 'mfa/challenge', true, 'files', true).inFiles).toBe(false);
  });

  it('still finds a needle that lives in real code when ignoreComments is true', () => {
    const real = { 'Api.kt': `val u = "https://host/mfa/challenge" // comment` };
    expect(searchCorpus(ctxFrom(real), 'mfa/challenge', true, 'files', true).inFiles).toBe(true);
  });
});
