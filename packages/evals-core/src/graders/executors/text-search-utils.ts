/**
 * Shared utilities for text-search grader executors.
 */

/** Extensions that identify non-source files (config files and documentation). */
export const NON_SOURCE_EXTS = /\.(?:env|json|plist|xml|yaml|yml|toml|ini|cfg|conf|md)$/i;

/** Filename prefixes that identify non-source (config-only) files. */
export const NON_SOURCE_PREFIXES = /^\.env/;

interface LangSyntax {
  /** Line-comment starters (e.g. `//`, `#`). */
  line: string[];
  /** Block-comment open/close pair, if the language has one. */
  block?: [string, string];
  /** Triple-quote string delimiters, matched before single-char ones (e.g. `"""`, `'''`). */
  triple?: string[];
  /** Single-char string delimiters whose contents are preserved. */
  strings: string[];
}

const C_FAMILY: LangSyntax = { line: ['//'], block: ['/*', '*/'], triple: ['"""'], strings: ['"', "'", '`'] };
const PYTHON: LangSyntax = { line: ['#'], triple: ['"""', "'''"], strings: ['"', "'"] };
const HASH: LangSyntax = { line: ['#'], strings: ['"', "'"] };

const SYNTAX_BY_EXT: Record<string, LangSyntax> = {
  kt: C_FAMILY,
  kts: C_FAMILY,
  java: C_FAMILY,
  js: C_FAMILY,
  jsx: C_FAMILY,
  mjs: C_FAMILY,
  cjs: C_FAMILY,
  ts: C_FAMILY,
  tsx: C_FAMILY,
  swift: C_FAMILY,
  go: C_FAMILY,
  c: C_FAMILY,
  h: C_FAMILY,
  cc: C_FAMILY,
  cpp: C_FAMILY,
  hpp: C_FAMILY,
  cs: C_FAMILY,
  m: C_FAMILY,
  mm: C_FAMILY,
  scala: C_FAMILY,
  rs: C_FAMILY,
  dart: C_FAMILY,
  php: C_FAMILY,
  py: PYTHON,
  rb: HASH,
  sh: HASH,
  bash: HASH,
  zsh: HASH,
  r: HASH,
  pl: HASH,
  pm: HASH,
};

/**
 * Return `content` with comments removed but string literals preserved, so a
 * substring search finds the token only in actual code — a real hand-rolled
 * `"https://.../mfa/challenge"` string still matches, while the same token in a
 * line or block comment does not. String-literal aware (a `//` inside a string
 * is not a comment), unlike a naive regex strip.
 *
 * Languages the eval scaffolds use are covered; an unknown extension returns
 * the content unchanged rather than risk mangling it.
 */
export function stripComments(content: string, filePath: string): string {
  const ext = (filePath.split('.').pop() ?? '').toLowerCase();
  const s = SYNTAX_BY_EXT[ext];
  if (!s) return content;

  let out = '';
  let i = 0;
  const n = content.length;

  while (i < n) {
    if (s.block && content.startsWith(s.block[0], i)) {
      const end = content.indexOf(s.block[1], i + s.block[0].length);
      i = end === -1 ? n : end + s.block[1].length;
      out += ' ';
      continue;
    }

    let matched = false;
    for (const lc of s.line) {
      if (content.startsWith(lc, i)) {
        const nl = content.indexOf('\n', i);
        i = nl === -1 ? n : nl; // keep the newline itself
        out += ' ';
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (s.triple) {
      for (const tq of s.triple) {
        if (content.startsWith(tq, i)) {
          const end = content.indexOf(tq, i + tq.length);
          const stop = end === -1 ? n : end + tq.length;
          out += content.slice(i, stop); // preserve string contents
          i = stop;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    const ch = content.charAt(i);
    if (s.strings.includes(ch)) {
      out += ch;
      i++;
      while (i < n) {
        const c = content.charAt(i);
        out += c;
        if (c === '\\') {
          if (i + 1 < n) out += content.charAt(i + 1);
          i += 2;
          continue;
        }
        i++;
        if (c === ch) break;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}
