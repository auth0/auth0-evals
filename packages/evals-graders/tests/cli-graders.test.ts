import { describe, it, expect } from 'vitest';
import { ranCliCommand, notRanCliCommand, noInventedCliInput, flagArg, positionalArg } from '../src/cli-graders.js';
import { GraderLevel, type EventToolCall } from '../src/types.js';

const bash = (command: string, extra: Partial<EventToolCall> = {}): EventToolCall => ({
  name: 'bash',
  args: { command },
  result: '',
  causedError: false,
  ...extra,
});
const write = (path: string, content: string): EventToolCall => ({
  name: 'write_file',
  args: { path, content },
  result: '',
  causedError: false,
});
const run = (g: { predicate?: (t: EventToolCall[]) => boolean }, ...calls: EventToolCall[]) => g.predicate!(calls);

const spa = () =>
  ranCliCommand(
    'auth0 apps create',
    [flagArg(['--name', '-n'], 'Partner Portal', 'name'), flagArg(['--type', '-t'], 'spa', 'app_type')],
    'x',
    GraderLevel.L5,
  );

describe('ranCliCommand', () => {
  it('passes a typed command with every value on its own flag', () => {
    expect(run(spa(), bash("auth0 apps create --name 'Partner Portal' --type spa"))).toBe(true);
    expect(run(spa(), bash('auth0 apps create -n "Partner Portal" -t spa'))).toBe(true);
    expect(run(spa(), bash('auth0 apps create --name=Partner\\ Portal --type=spa'))).toBe(true);
  });

  it('is an event grader at the requested level and rejects other levels', () => {
    expect(spa()).toMatchObject({ kind: 'event', level: GraderLevel.L5 });
    expect(() => ranCliCommand('auth0 apps create', [], 'x', GraderLevel.L2 as never)).toThrow(/L4|L5/);
  });

  it('does not count a value that belongs to another command in the same call', () => {
    expect(run(spa(), bash('auth0 apps create --name a && auth0 apis create --name "Partner Portal" --type spa'))).toBe(
      false,
    );
  });

  it('does not count a help probe next to a raw API request', () => {
    expect(
      run(
        spa(),
        bash(
          'auth0 api post clients --data \'{"name":"Partner Portal","app_type":"spa"}\' && auth0 apps create --help',
        ),
      ),
    ).toBe(false);
  });

  it('ignores help and -h probes, quoted or not', () => {
    expect(run(spa(), bash("auth0 apps create --name 'Partner Portal' --type spa --help"))).toBe(false);
    expect(run(spa(), bash("auth0 apps create --name 'Partner Portal' --type spa -h"))).toBe(false);
    expect(run(spa(), bash("auth0 apps create --name 'Partner Portal' --type spa '--help'"))).toBe(false);
  });

  it('does not accept a command that only appears inside an argument', () => {
    expect(run(spa(), bash("printf '%s\\n' 'apps create' --name 'Partner Portal' --type spa"))).toBe(false);
    expect(run(spa(), bash("echo auth0 apps create --name 'Partner Portal' --type spa"))).toBe(false);
  });

  it('requires the whole argument, not the tail of a longer one', () => {
    const g = ranCliCommand('auth0 apps create', [flagArg('--name', 'acme')], 'x', GraderLevel.L5);
    expect(run(g, bash('auth0 apps create --name not-acme'))).toBe(false);
    expect(run(g, bash('auth0 apps create --name acme-2'))).toBe(false);
    expect(run(g, bash('auth0 apps create --name acme'))).toBe(true);
  });

  it('matches a value followed by a closing quote or parenthesis', () => {
    expect(run(spa(), bash('bash -c "auth0 apps create --name \'Partner Portal\' --type spa"'))).toBe(true);
    const api = ranCliCommand(
      'auth0 apis create',
      [flagArg(['--identifier', '-i'], 'https://orders.acme.test')],
      'x',
      GraderLevel.L5,
    );
    expect(run(api, bash('ID=$(auth0 apis create --identifier https://orders.acme.test)'))).toBe(true);
    expect(run(api, bash('ID=`auth0 apis create --identifier https://orders.acme.test`'))).toBe(true);
  });

  it('survives an apostrophe in a comment before the command', () => {
    const call = "# Let's check\nauth0 apps create --help\nauth0 apps create --name 'Partner Portal' --type spa";
    expect(run(spa(), bash(call))).toBe(true);
  });

  it('reads a command split by a line continuation', () => {
    expect(run(spa(), bash("auth0 apps cre\\\nate --name 'Partner Portal' \\\n  --type spa"))).toBe(true);
  });

  it('credits the commands that ran in a call whose later step failed', () => {
    const call = "auth0 apps create --name 'Partner Portal' --type spa && auth0 client-grants create --client-id bad";
    expect(run(spa(), bash(call, { causedError: true }))).toBe(true);
  });

  it('accepts inline JSON from --data through the jsonKey', () => {
    const call = `auth0 apps create --data '{"name":"Partner Portal","app_type":"spa"}'`;
    expect(run(spa(), bash(call))).toBe(true);
    expect(run(spa(), bash(`auth0 apps create --data '{"name":"Partner Portal","app_type":"regular_web"}'`))).toBe(
      false,
    );
  });

  it('does not split on a semicolon inside a quoted --data payload', () => {
    const call = `auth0 apps create --data '{"name":"Partner Portal; x","app_type":"spa"}' --name 'Partner Portal'`;
    expect(run(spa(), bash(call))).toBe(true);
  });

  it('reads a --data @file payload written with the write tool', () => {
    const body = JSON.stringify({ name: 'Partner Portal', app_type: 'spa' });
    expect(run(spa(), write('/tmp/body.json', body), bash('auth0 apps create --data @/tmp/body.json'))).toBe(true);
    expect(run(spa(), write('/tmp/body.json', body), bash('auth0 apps create --data=@body.json'))).toBe(true);
    expect(run(spa(), bash('auth0 apps create --data @/tmp/missing.json'))).toBe(false);
  });

  it('gives no credit to the last command of a failed call', () => {
    const create = "auth0 apps create --name 'Partner Portal' --type spa";
    expect(run(spa(), bash(create, { causedError: true }))).toBe(false);
    expect(run(spa(), bash(create + ' 2>&1', { causedError: true }))).toBe(false);
    expect(run(spa(), bash('bash -c "' + create + '"', { causedError: true }))).toBe(false);
    // An earlier step of the chain still counts.
    expect(run(spa(), bash(create + ' && auth0 apis list', { causedError: true }))).toBe(true);
  });

  it('skips the auth0 global flags before and between the subcommand words', () => {
    expect(run(spa(), bash("auth0 --tenant t.auth0.com apps create --name 'Partner Portal' --type spa"))).toBe(true);
    expect(run(spa(), bash("auth0 --no-input apps create --name 'Partner Portal' --type spa"))).toBe(true);
    expect(run(spa(), bash("auth0 apps --tenant=t.auth0.com create --name 'Partner Portal' --type spa"))).toBe(true);
    expect(run(spa(), bash("auth0 --other apps create --name 'Partner Portal' --type spa"))).toBe(false);
  });

  it('reads --data @file written by tee, echo -n and printf', () => {
    const body = '{"name":"Partner Portal","app_type":"spa"}';
    const send = bash('auth0 apps create --data @/tmp/b.json');
    expect(run(spa(), bash("echo -n '" + body + "' > /tmp/b.json"), send)).toBe(true);
    expect(run(spa(), bash("printf '%s' '" + body + "' > /tmp/b.json"), send)).toBe(true);
    expect(run(spa(), bash("printf '%s\\n' '" + body + "' | tee /tmp/b.json"), send)).toBe(true);
    expect(run(spa(), bash("tee /tmp/b.json <<'EOF'\n" + body + '\nEOF'), send)).toBe(true);
  });

  it('uses the latest write to a file, and only a write that came before the command', () => {
    const portal = JSON.stringify({ name: 'Partner Portal', app_type: 'spa' });
    const draft = JSON.stringify({ name: 'Draft', app_type: 'spa' });
    const send = bash('auth0 apps create --data @/ws/body.json');
    expect(run(spa(), write('/ws/body.json', draft), write('/ws/body.json', portal), send)).toBe(true);
    expect(run(spa(), write('/ws/body.json', portal), write('/ws/body.json', draft), send)).toBe(false);
    expect(run(spa(), send, write('/ws/body.json', portal))).toBe(false);
  });

  it('does not read an edit as the whole file', () => {
    const edit: EventToolCall = {
      name: 'edit',
      args: { path: '/ws/body.json', content: '{"name":"Partner Portal","app_type":"spa"}' },
      result: '',
      causedError: false,
    };
    expect(run(spa(), edit, bash('auth0 apps create --data @/ws/body.json'))).toBe(false);
  });

  it('reads a --data @file payload written with a heredoc', () => {
    const call =
      'cat > /tmp/b.json <<\'EOF\'\n{"name":"Partner Portal","app_type":"spa"}\nEOF\nauth0 apps create --data @/tmp/b.json';
    expect(run(spa(), bash(call))).toBe(true);
  });

  it('accepts any of several alternative commands', () => {
    const g = ranCliCommand(['auth0 apps create', 'auth0 qs setup'], [flagArg('--name', 'x')], 'x', GraderLevel.L4);
    expect(run(g, bash('auth0 qs setup --name x'))).toBe(true);
  });

  it('sees commands through env, a path, and bash -c', () => {
    expect(
      run(spa(), bash("AUTH0_DOMAIN=t.auth0.com /usr/local/bin/auth0 apps create -n 'Partner Portal' -t spa")),
    ).toBe(true);
  });

  it('fails when nothing ran', () => {
    expect(run(spa())).toBe(false);
    expect(run(spa(), { name: 'read_file', args: { path: 'a' }, result: '', causedError: false })).toBe(false);
  });
});

describe('flagArg', () => {
  it('does not take a value from a different flag', () => {
    const b = flagArg('--name', 'spa');
    expect(b(['--type', 'spa'])).toBe(false);
    expect(b(['--name', 'spa'])).toBe(true);
  });

  it('ignores a JSON key when none was asked for', () => {
    expect(flagArg('--name', 'x')(['--data', '{"name":"x"}'])).toBe(false);
    expect(flagArg('--name', 'x', 'name')(['--data', '{"name":"x"}'])).toBe(true);
  });

  it('needs the JSON value to be the whole string and the key to be top level', () => {
    const b = flagArg('--name', 'x', 'name');
    expect(b(['--data', '{"name":"xy"}'])).toBe(false);
    expect(b(['--data', '{"inner":{"name":"x"}}'])).toBe(false);
    expect(b(['--data', '{not json'])).toBe(false);
  });
});

describe('positionalArg', () => {
  it('matches the first positional argument', () => {
    expect(positionalArg('login-id')(['login-id'])).toBe(true);
    expect(positionalArg('login-id')(['--json', 'login-id'])).toBe(true);
    expect(positionalArg('login-id')(['login-id-2'])).toBe(false);
  });

  it('skips the values of flags that take one', () => {
    const b = positionalArg('login-id', { valueFlags: ['-l', '--language'] });
    expect(b(['-l', 'en', 'login-id'])).toBe(true);
    expect(positionalArg('login-id')(['-l', 'en', 'login-id'])).toBe(false);
  });

  it('supports an index', () => {
    expect(positionalArg('b', { index: 1 })(['a', 'b'])).toBe(true);
    expect(positionalArg('b', { index: 0 })(['a', 'b'])).toBe(false);
  });
});

describe('notRanCliCommand', () => {
  const g = notRanCliCommand('auth0 apps delete', 'x', GraderLevel.L2);

  it('sees a delete behind a global flag or a wrapper', () => {
    expect(run(g, bash('auth0 --no-input apps delete x'))).toBe(false);
    expect(run(g, bash('auth0 apps list --json | jq -r ".[].client_id" | xargs -n1 auth0 apps delete --force'))).toBe(
      false,
    );
    expect(run(g, bash('xargs -I{} auth0 apps delete {}'))).toBe(false);
    expect(run(g, bash('npx -y auth0 apps delete x'))).toBe(false);
    expect(run(g, bash('timeout 60 auth0 apps delete x'))).toBe(false);
    expect(run(g, bash('sudo -u me auth0 apps delete x'))).toBe(false);
  });

  it('sees a delete in a script given to a shell by heredoc or pipe', () => {
    expect(run(g, bash("bash <<'EOF'\nauth0 apps delete abc\nEOF"))).toBe(false);
    expect(run(g, bash("echo 'auth0 apps delete abc' | sh"))).toBe(false);
    expect(run(g, bash("printf '%s' 'auth0 apps delete abc' | bash -s"))).toBe(false);
    expect(run(g, bash("echo 'auth0 apps delete abc' | cat"))).toBe(true);
  });

  it('still sees a later delete when a substitution cannot be closed', () => {
    expect(run(g, bash("X=$( # don't\n echo hi )\nauth0 apps delete abc --force"))).toBe(false);
    expect(run(g, bash("X=$(cat <<'EOF'\nit's\nEOF\n)\nauth0 apps delete q"))).toBe(false);
  });

  it('passes when no delete ran', () => {
    expect(run(g, bash('auth0 apps list'))).toBe(true);
    expect(run(g)).toBe(true);
  });

  it('fails on a delete, including one inside a chain, a substitution or a failed call', () => {
    expect(run(g, bash('auth0 apps delete abc --force'))).toBe(false);
    expect(run(g, bash('auth0 apps list && auth0 apps delete abc'))).toBe(false);
    expect(run(g, bash('bash -c "auth0 apps delete abc"'))).toBe(false);
    expect(run(g, bash('auth0 apps delete abc', { causedError: true }))).toBe(false);
  });

  it('ignores help probes and text that only mentions the command', () => {
    expect(run(g, bash('auth0 apps delete --help'))).toBe(true);
    expect(run(g, bash("auth0 --help | grep 'apps delete'"))).toBe(true);
    expect(run(g, bash("echo 'auth0 apps delete'"))).toBe(true);
  });
});

describe('noInventedCliInput', () => {
  const g = noInventedCliInput();

  it('is an L2 event grader', () => {
    expect(g).toMatchObject({ kind: 'event', level: GraderLevel.L2 });
  });

  it('fails when the CLI rejected a command or flag', () => {
    expect(run(g, bash('auth0 apps nope', { result: 'Error: unknown command "nope" for "auth0 apps"' }))).toBe(false);
    expect(run(g, bash('auth0 apps list --bad', { result: 'unknown shorthand flag: x', causedError: true }))).toBe(
      false,
    );
    expect(run(g, bash('auth0 apps list --bad', { result: '{"error":{"reason":"flag_parse","message":"x"}}' }))).toBe(
      false,
    );
  });

  it('passes on tenant data that happens to contain the words', () => {
    expect(run(g, bash('auth0 apps list --json', { result: '[{"name":"Unknown Command"}]' }))).toBe(true);
    expect(run(g, bash('auth0 apps list', { result: 'Name: unknown command center' }))).toBe(true);
  });

  it('only reads shell calls', () => {
    expect(run(g, { name: 'read_file', args: {}, result: 'unknown command', causedError: false })).toBe(true);
  });
});
