/**
 * A small shell parser for grading what an agent ran.
 *
 * Event graders need to know which commands a shell call executed and which arguments each one
 * received. Substring checks on the raw text cannot tell `auth0 apps create --help` from a real
 * create, `printf 'apps create'` from `auth0 apps create`, or a value inside a quoted payload from a
 * separate argument. This parser splits a call into simple commands and decodes each one into the words
 * the shell would pass: quotes removed, escapes and line continuations resolved, comments skipped.
 *
 * It is not a full shell. It does not expand variables, globs or braces, and it does not run anything.
 * Command substitutions ($(...) and backticks), `bash -c` scripts, `eval` strings and subshells are parsed
 * as commands of their own, so a command run through them is still seen.
 */

/** One simple command, as the shell would run it. */
export interface ShellCommand {
  /**
   * Decoded words. The first is the executable's base name (`/opt/bin/auth0` becomes `auth0`).
   * Leading `NAME=value` assignments, wrappers such as `env` or `sudo`, and redirections are removed.
   */
  words: string[];
  /** Files this command writes with a redirect: a heredoc body, or the arguments of `echo` / `printf`. */
  writes: Array<{ path: string; content: string }>;
}

interface Draft {
  words: string[];
  writeTargets: string[];
  heredocBody?: string;
  /** Commands found inside this command's $(...) and backticks. */
  children: ShellCommand[];
  /** The command whose output is piped into this one. */
  pipedFrom?: Draft;
}

const MAX_DEPTH = 5;
/** Commands that run another command: the flags that take a value, and how many plain arguments come first. */
const WRAPPERS: Record<string, { values: string[]; positional: number }> = {
  env: { values: ['-u', '-C', '-S'], positional: 0 },
  command: { values: [], positional: 0 },
  exec: { values: ['-a'], positional: 0 },
  time: { values: [], positional: 0 },
  nohup: { values: [], positional: 0 },
  builtin: { values: [], positional: 0 },
  sudo: { values: ['-u', '-g', '-h', '-p', '-C', '-r', '-t'], positional: 0 },
  xargs: { values: ['-n', '-I', '-P', '-L', '-d', '-E', '-s', '-a'], positional: 0 },
  timeout: { values: ['-s', '-k'], positional: 1 },
  npx: { values: ['-p', '--package', '-c'], positional: 0 },
};
const RESERVED_LEADING = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Index of the `)` that closes the `(` just before `start`, or -1. Quotes and nested groups are skipped. */
function closingParen(src: string, start: number): number {
  let depth = 1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
    } else if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (ch === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '$' && src[i + 1] === '(') {
          const inner = closingParen(src, i + 2);
          if (inner === -1) return -1;
          i = inner;
        }
      }
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')' && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/** Index of the backtick that closes the one just before `start`, or -1. */
function closingBacktick(src: string, start: number): number {
  for (let i = start; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '`') return i;
  }
  return -1;
}

function parseScript(src: string, depth: number): ShellCommand[] {
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  let word = '';
  let hasWord = false;
  let pending: 'write' | 'heredoc' | 'ignore' | undefined;
  const heredocs: Array<{ delimiter: string; stripTabs: boolean; draft: Draft }> = [];
  let redirectIsHeredocStrip = false;
  let lastEnded: Draft | undefined;
  let pipeNext = false;

  const draft = (): Draft => {
    if (!current) {
      current = { words: [], writeTargets: [], children: [], pipedFrom: pipeNext ? lastEnded : undefined };
      pipeNext = false;
      drafts.push(current);
    }
    return current;
  };
  const sub = (text: string) => {
    if (depth < MAX_DEPTH) draft().children.push(...parseScript(text, depth + 1));
  };
  const endWord = () => {
    if (!hasWord) return;
    const done = word;
    word = '';
    hasWord = false;
    if (pending === 'write') draft().writeTargets.push(done);
    else if (pending === 'heredoc')
      heredocs.push({ delimiter: done, stripTabs: redirectIsHeredocStrip, draft: draft() });
    else if (pending === undefined) draft().words.push(done);
    pending = undefined;
  };
  const endCommand = () => {
    endWord();
    pending = undefined;
    if (current) lastEnded = current;
    current = undefined;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    const next = src[i + 1];

    if (ch === '\\') {
      if (next === '\n') i++;
      else if (next === '\r' && src[i + 2] === '\n') i += 2;
      else if (next !== undefined) {
        word += next;
        hasWord = true;
        i++;
      }
      continue;
    }
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      word += src.slice(i + 1, end === -1 ? undefined : end);
      hasWord = true;
      i = end === -1 ? src.length : end;
      continue;
    }
    if (ch === '"') {
      hasWord = true;
      for (i++; i < src.length && src[i] !== '"'; i++) {
        const c = src[i] as string;
        if (c === '\\') {
          const n = src[i + 1];
          if (n === '\n') i++;
          else if (n !== undefined && '$`"\\'.includes(n)) {
            word += n;
            i++;
          } else word += c;
        } else if (c === '$' && src[i + 1] === '(') {
          const end = closingParen(src, i + 2);
          if (end === -1) {
            word += '$(';
            i++;
          } else {
            sub(src.slice(i + 2, end));
            word += src.slice(i, end + 1);
            i = end;
          }
        } else if (c === '`') {
          const end = closingBacktick(src, i + 1);
          if (end === -1) word += c;
          else {
            sub(src.slice(i + 1, end));
            word += src.slice(i, end + 1);
            i = end;
          }
        } else word += c;
      }
      continue;
    }
    if (ch === '$' && next === '(') {
      const end = closingParen(src, i + 2);
      hasWord = true;
      if (end === -1) {
        // Cannot find the close (a comment or heredoc inside the substitution can hide it): keep the text and carry on.
        word += '$(';
        i++;
        continue;
      }
      sub(src.slice(i + 2, end));
      word += src.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = closingBacktick(src, i + 1);
      hasWord = true;
      if (end === -1) {
        word += ch;
        continue;
      }
      sub(src.slice(i + 1, end));
      word += src.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '#' && !hasWord) {
      const end = src.indexOf('\n', i);
      if (end === -1) break;
      i = end - 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endWord();
      continue;
    }
    if (ch === '\n') {
      endWord();
      // Heredoc bodies start on the next line and run to a line holding only the delimiter.
      let start = i + 1;
      for (const h of heredocs.splice(0)) {
        const lines: string[] = [];
        let pos = start;
        for (;;) {
          if (pos >= src.length) break;
          const eol = src.indexOf('\n', pos);
          const line = src.slice(pos, eol === -1 ? undefined : eol);
          pos = eol === -1 ? src.length : eol + 1;
          if ((h.stripTabs ? line.replace(/^\t+/, '') : line).replace(/\r$/, '') === h.delimiter) break;
          lines.push(line);
        }
        h.draft.heredocBody = lines.join('\n');
        start = pos;
      }
      i = start - 1;
      endCommand();
      continue;
    }
    if (ch === '<' || ch === '>' || (ch === '&' && next === '>')) {
      // A bare number just before the operator is a file descriptor (2>&1), not an argument.
      if (hasWord && /^\d+$/.test(word) && pending === undefined) {
        word = '';
        hasWord = false;
      } else endWord();
      let op = ch;
      if (ch === '&') op = '&>';
      let skip = 0;
      if (ch === '<' && next === '<') {
        op = src[i + 2] === '<' ? '<<<' : src[i + 2] === '-' ? '<<-' : '<<';
        skip = op.length - 1;
      } else if (ch === '>' && (next === '>' || next === '|' || next === '&')) {
        op = ch + next;
        skip = 1;
      } else if (ch === '<' && next === '&') {
        op = '<&';
        skip = 1;
      } else if (ch === '&') skip = 1;
      i += skip;
      redirectIsHeredocStrip = op === '<<-';
      if (op === '<<' || op === '<<-') pending = 'heredoc';
      else if (op === '>' || op === '>>' || op === '>|' || op === '&>') pending = 'write';
      else pending = 'ignore';
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      endCommand();
      if (ch === '|' && next !== '|') {
        // A pipe: the next command reads this one's output. `|&` is a pipe too.
        pipeNext = true;
        if (next === '&') i++;
      } else {
        pipeNext = false;
        if ((ch === '|' && next === '|') || (ch === '&' && next === '&')) i++;
      }
      continue;
    }
    word += ch;
    hasWord = true;
  }
  endCommand();

  const out: ShellCommand[] = [];
  for (const d of drafts) {
    const words = normalise(d.words);
    const exe = words[0];
    const fromHeredocOrEcho = producedText(words, d.heredocBody);
    const piped = d.pipedFrom ? producedText(normalise(d.pipedFrom.words), d.pipedFrom.heredocBody) : undefined;
    const teeTargets = exe === 'tee' ? words.slice(1).filter((w) => !w.startsWith('-')) : [];
    const content = exe === 'tee' ? (d.heredocBody ?? piped) : fromHeredocOrEcho;
    const writes = content === undefined ? [] : [...d.writeTargets, ...teeTargets].map((path) => ({ path, content }));
    if (words.length > 0 || d.writeTargets.length > 0) out.push({ words, writes });
    out.push(...d.children);

    if (depth >= MAX_DEPTH || exe === undefined) continue;
    if (SHELLS.has(exe)) {
      const flag = words.findIndex((w, k) => k > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(w));
      if (flag !== -1) {
        const script = words[flag + 1];
        if (script !== undefined) out.push(...parseScript(script, depth + 1));
      } else if (words.slice(1).every((w) => w.startsWith('-'))) {
        // No script file: the shell reads its script from a heredoc or a pipe.
        const script = d.heredocBody ?? piped;
        if (script !== undefined) out.push(...parseScript(script, depth + 1));
      }
    } else if (exe === 'eval') {
      out.push(...parseScript(words.slice(1).join(' '), depth + 1));
    }
  }
  return out;
}

const baseName = (w: string) => w.replace(/^.*\//, '');

/** Drops reserved words, assignments and wrappers (env, sudo, xargs, timeout, npx...) so the executable comes first. */
function normalise(raw: string[]): string[] {
  const words = [...raw];
  for (;;) {
    while (words.length > 0 && RESERVED_LEADING.has(words[0] as string)) words.shift();
    while (words.length > 0 && ASSIGNMENT.test(words[0] as string)) words.shift();
    const wrapper = words[0] === undefined ? undefined : WRAPPERS[baseName(words[0])];
    if (!wrapper) break;
    words.shift();
    let positional = wrapper.positional;
    while (words.length > 0) {
      const w = words[0] as string;
      if (w.startsWith('-')) {
        words.shift();
        if (wrapper.values.includes(w)) words.shift();
      } else if (ASSIGNMENT.test(w)) words.shift();
      else if (positional > 0) {
        positional--;
        words.shift();
      } else break;
    }
  }
  if (words[0] !== undefined) words[0] = baseName(words[0]);
  return words;
}

/** What a command writes to its output: a heredoc body it reads, or the text `echo` / `printf` prints. */
function producedText(words: string[], heredocBody: string | undefined): string | undefined {
  if (heredocBody !== undefined) return heredocBody;
  if (words[0] === 'echo') {
    const args = words.slice(1);
    while (args[0] !== undefined && /^-[neE]+$/.test(args[0])) args.shift();
    return args.join(' ');
  }
  if (words[0] === 'printf') {
    const [format = '', ...rest] = words.slice(1);
    const specs = (format.match(/%[sbd]/g) ?? []).length;
    const escapes: Record<string, string> = { n: '\n', t: '\t', '\\': '\\' };
    let text = '';
    do {
      text += format.replace(/%([sbd%])|\\([nt\\])/g, (_m, spec?: string, esc?: string) =>
        spec === undefined ? (escapes[esc as string] ?? '') : spec === '%' ? '%' : (rest.shift() ?? ''),
      );
    } while (specs > 0 && rest.length > 0);
    return text;
  }
  return undefined;
}

/** Splits a shell call into the simple commands it runs, nested ones included. */
export function parseShell(call: string): ShellCommand[] {
  return parseScript(call, 0);
}
