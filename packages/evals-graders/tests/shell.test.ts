import { describe, it, expect } from 'vitest';
import { parseShell } from '../src/shell.js';

const words = (call: string) => parseShell(call).map((c) => c.words);

describe('parseShell', () => {
  it('splits on && || ; | and newlines', () => {
    expect(words('auth0 apps create --name a && auth0 apis create --name b')).toEqual([
      ['auth0', 'apps', 'create', '--name', 'a'],
      ['auth0', 'apis', 'create', '--name', 'b'],
    ]);
    expect(words('a || b; c | d\ne')).toEqual([['a'], ['b'], ['c'], ['d'], ['e']]);
  });

  it('does not split inside quotes', () => {
    expect(words('echo "a && b; c"')).toEqual([['echo', 'a && b; c']]);
    expect(words('auth0 apps create --data \'{"name":"x";"app_type":"spa"}\'')).toHaveLength(1);
  });

  it('removes quotes and keeps adjacent pieces in one word', () => {
    expect(words(String.raw`auth0 apps create --name 'Partner Portal' --type="spa" a'b'"c"`)).toEqual([
      ['auth0', 'apps', 'create', '--name', 'Partner Portal', '--type=spa', 'abc'],
    ]);
  });

  it('keeps an empty quoted argument', () => {
    expect(words("cmd '' x")).toEqual([['cmd', '', 'x']]);
  });

  it('resolves backslash escapes outside and inside double quotes', () => {
    expect(words(String.raw`cmd a\ b "c\"d" 'e\f'`)).toEqual([['cmd', 'a b', 'c"d', String.raw`e\f`]]);
  });

  it('joins a line continuation without inserting a space', () => {
    expect(words('auth0 apps cre\\\nate --name x')).toEqual([['auth0', 'apps', 'create', '--name', 'x']]);
    expect(words('auth0 apps create \\\n  --name x')).toEqual([['auth0', 'apps', 'create', '--name', 'x']]);
  });

  it('skips comments, including an apostrophe in one', () => {
    expect(words("# Let's check\nauth0 apps create --help\nauth0 apps create --name P --type spa")).toEqual([
      ['auth0', 'apps', 'create', '--help'],
      ['auth0', 'apps', 'create', '--name', 'P', '--type', 'spa'],
    ]);
    expect(words('auth0 apps list # all of them')).toEqual([['auth0', 'apps', 'list']]);
  });

  it('keeps a # that is not at the start of a word', () => {
    expect(words('cmd a#b "#c"')).toEqual([['cmd', 'a#b', '#c']]);
  });

  it('parses the commands inside $(...) and backticks as commands of their own', () => {
    const cmds = words('ID=$(auth0 apis create --identifier https://orders.acme.test) && echo done');
    expect(cmds).toContainEqual(['auth0', 'apis', 'create', '--identifier', 'https://orders.acme.test']);
    expect(cmds).toContainEqual(['echo', 'done']);
    expect(words('echo `auth0 apps list`')).toContainEqual(['auth0', 'apps', 'list']);
    expect(words('echo "$(auth0 apps list; auth0 apis list)"')).toContainEqual(['auth0', 'apis', 'list']);
  });

  it('does not treat a ; inside $(...) as a boundary of the outer command', () => {
    const cmds = words('echo $(a; b) tail');
    expect(cmds).toContainEqual(['echo', '$(a; b)', 'tail']);
  });

  it('parses bash -c, sh -lc and eval scripts', () => {
    expect(words('bash -c "auth0 apps create --type spa"')).toContainEqual([
      'auth0',
      'apps',
      'create',
      '--type',
      'spa',
    ]);
    expect(words("sh -lc 'auth0 apis list'")).toContainEqual(['auth0', 'apis', 'list']);
    expect(words('eval "auth0 apps list"')).toContainEqual(['auth0', 'apps', 'list']);
  });

  it('removes assignments, wrappers and the executable path', () => {
    expect(words('AUTH0_DOMAIN=x env -i FOO=1 /opt/homebrew/bin/auth0 apps list')).toEqual([['auth0', 'apps', 'list']]);
    expect(words('sudo auth0 apps list')).toEqual([['auth0', 'apps', 'list']]);
  });

  it('reads subshells and groups as commands', () => {
    expect(words('(cd /tmp && auth0 apps list)')).toEqual([
      ['cd', '/tmp'],
      ['auth0', 'apps', 'list'],
    ]);
  });

  it('drops redirections from the words', () => {
    expect(words('auth0 apps list --json > /tmp/out.json 2>&1')).toEqual([['auth0', 'apps', 'list', '--json']]);
    expect(words('auth0 apps list &> /dev/null')).toEqual([['auth0', 'apps', 'list']]);
    expect(words('cat < in.txt')).toEqual([['cat']]);
  });

  it('records heredoc bodies as file writes and does not run them as commands', () => {
    const [cmd] = parseShell('cat > /tmp/body.json <<\'EOF\'\n{"name":"x"}\nauth0 apps delete\nEOF\nauth0 apps list');
    expect(cmd?.words).toEqual(['cat']);
    expect(cmd?.writes).toEqual([{ path: '/tmp/body.json', content: '{"name":"x"}\nauth0 apps delete' }]);
    expect(words('cat <<EOF\nauth0 apps delete\nEOF\nauth0 apps list')).toEqual([['cat'], ['auth0', 'apps', 'list']]);
  });

  it('keeps commands that follow a heredoc on the same line', () => {
    expect(words('cat <<EOF && auth0 apps list\nbody\nEOF\nauth0 apis list')).toEqual([
      ['cat'],
      ['auth0', 'apps', 'list'],
      ['auth0', 'apis', 'list'],
    ]);
  });

  it('records echo and printf redirects as file writes', () => {
    const [cmd] = parseShell(`echo '{"name":"x"}' > /tmp/body.json`);
    expect(cmd?.writes).toEqual([{ path: '/tmp/body.json', content: '{"name":"x"}' }]);
  });

  it('keeps the commands of a substitution next to their parent, in source order', () => {
    expect(words('a $(b) && c')).toEqual([['a', '$(b)'], ['b'], ['c']]);
  });

  it('unwraps xargs, timeout, npx and sudo with their flags', () => {
    expect(words('xargs -n 1 -I{} auth0 apps delete {}')).toEqual([['auth0', 'apps', 'delete', '{}']]);
    expect(words('timeout -s KILL 60 auth0 apps list')).toEqual([['auth0', 'apps', 'list']]);
    expect(words('npx -y auth0 apps list')).toEqual([['auth0', 'apps', 'list']]);
    expect(words('sudo -u me auth0 apps list')).toEqual([['auth0', 'apps', 'list']]);
  });

  it('reads a script piped into a shell or given as a heredoc', () => {
    expect(words("echo 'auth0 apps delete x' | sh")).toContainEqual(['auth0', 'apps', 'delete', 'x']);
    expect(words('cat <<EOF | bash\nauth0 apps delete x\nEOF')).toContainEqual(['auth0', 'apps', 'delete', 'x']);
    expect(words("echo 'auth0 apps delete x' || sh")).not.toContainEqual(['auth0', 'apps', 'delete', 'x']);
    expect(words("echo 'auth0 apps delete x'\nsh")).not.toContainEqual(['auth0', 'apps', 'delete', 'x']);
  });

  it('records writes by tee, echo -n and printf', () => {
    const writes = (call: string) => parseShell(call).flatMap((c) => c.writes);
    expect(writes("echo -n 'x y' > f")).toEqual([{ path: 'f', content: 'x y' }]);
    expect(writes("printf '%s' 'x y' > f")).toEqual([{ path: 'f', content: 'x y' }]);
    expect(writes("printf '%s\\n' a b > f")).toEqual([{ path: 'f', content: 'a\nb\n' }]);
    expect(writes('echo hi | tee -a f g')).toEqual([
      { path: 'f', content: 'hi' },
      { path: 'g', content: 'hi' },
    ]);
    expect(writes('tee f <<EOF\nbody\nEOF')).toEqual([{ path: 'f', content: 'body' }]);
  });

  it('keeps going on unterminated quotes and substitutions', () => {
    expect(() => parseShell("echo 'unterminated")).not.toThrow();
    expect(() => parseShell('echo "unterminated $(auth0')).not.toThrow();
    expect(() => parseShell('echo $(unterminated')).not.toThrow();
    expect(words('')).toEqual([]);
  });

  it('stops following nested scripts at a fixed depth', () => {
    let call = 'auth0 apps delete';
    for (let i = 0; i < 20; i++) call = `bash -c ${JSON.stringify(call)}`;
    expect(() => parseShell(call)).not.toThrow();
  });
});
