import { beforeAll, describe, expect, it } from 'vitest';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AGENT_LEVELS,
  DEFAULT_FRAMEWORK_CONFIG,
  runCompileCommand,
  runGraders,
  setFrameworkConfig,
} from '@a0/evals-core';
import type { EventToolCall } from '@a0/evals-graders';
import { defineGraders } from '../../../apps/auth0-evals/src/evals/mfa/express-api/graders.js';
import { makeTmpDir } from './tmp.js';

const EVAL_DIR = resolve(import.meta.dirname, '../../../apps/auth0-evals/src/evals/mfa/express-api');
const SCAFFOLD_DIR = join(EVAL_DIR, 'scaffold');

const L1 = 'Requires the step-up scope transfer:funds with requiredScopes';
const FUNDS = 'POST /api/transfers requires the step-up scope transfer:funds';
const WRITE = 'POST /api/transfers requires write:transfers';
const READ = 'GET /api/balance requires read:balance';
const ENV_WRITTEN = 'Wrote Auth0 config to .env file';
const COMPILES = 'Project compiles (node --check succeeds)';

const ENV_CALL: EventToolCall = {
  name: 'write_file',
  args: {
    path: '.env',
    content: 'ISSUER_BASE_URL=https://dev-barkbook.us.auth0.com\nAUDIENCE=https://api.barkbook.com\n',
  },
  result: 'ok',
  causedError: false,
};

const HEAD = `const express = require('express');
const { auth, requiredScopes } = require('express-oauth2-jwt-bearer');

const app = express();
app.use(express.json());

const checkJwt = auth();
`;

const TAIL = `
app.use((err, req, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  next(err);
});

app.listen(3001);
`;

const GET_OK = `app.get('/api/balance', checkJwt, requiredScopes('read:balance'), (req, res) => {
  res.json({ balance: 4200, sub: req.auth.payload.sub });
});
`;

const POST_HANDLER = `(req, res) => {
  res.status(201).json({ transferred: req.body.amount, sub: req.auth.payload.sub });
}`;

/** Builds a server.js from a preamble (before routes), a GET route and a POST route. */
const server = (opts: { before?: string; get?: string; post: string; after?: string }) =>
  `${HEAD}${opts.before ?? ''}\n${opts.get ?? GET_OK}\n${opts.post}\n${opts.after ?? ''}${TAIL}`;

const post = (middleware: string) => `app.post('/api/transfers', ${middleware}, ${POST_HANDLER});`;

interface Case {
  label: string;
  /** null leaves the scaffold's server.js untouched. */
  source: string | null;
  l1: boolean;
  funds: boolean;
  write: boolean;
  read: boolean;
}

const REFERENCE = server({
  post: `// The tenant's Action adds transfer:funds only after MFA, so requiring it is the step-up gate.
app.post('/api/transfers', checkJwt, requiredScopes('write:transfers'), requiredScopes('transfer:funds'), ${POST_HANDLER});`,
});

const VALID: Case[] = [
  {
    label: 'const indirection',
    source: server({
      before: `const requireStepUp = requiredScopes('transfer:funds');`,
      post: post(`checkJwt, requiredScopes('write:transfers'), requireStepUp`),
    }),
    l1: true,
    funds: true,
    write: true,
    read: true,
  },
  {
    label: 'array form',
    source: server({ post: post(`checkJwt, requiredScopes(['write:transfers', 'transfer:funds'])`) }),
    l1: true,
    funds: true,
    write: true,
    read: true,
  },
  {
    label: 'multiline route args, double quotes, space-delimited scope string',
    source: server({
      post: `app.post(
  '/api/transfers',
  checkJwt,
  requiredScopes("write:transfers transfer:funds"),
  ${POST_HANDLER},
);`,
    }),
    l1: true,
    funds: true,
    write: true,
    read: true,
  },
  {
    label: 'middleware array',
    source: server({
      before: `const transferGuards = [checkJwt, requiredScopes('write:transfers'), requiredScopes('transfer:funds')];`,
      post: post(`transferGuards`),
    }),
    l1: true,
    funds: true,
    write: true,
    read: true,
  },
  {
    label: 'app.route().post() without semicolons',
    source: `const express = require('express')
const { auth, requiredScopes } = require('express-oauth2-jwt-bearer')

const app = express()
app.use(express.json())

const checkJwt = auth()

app.get('/api/balance', checkJwt, requiredScopes('read:balance'), (req, res) => {
  res.json({ balance: 4200 })
})

app.route('/api/transfers')
  .post(checkJwt, requiredScopes('write:transfers'), requiredScopes('transfer:funds'), (req, res) => {
    res.status(201).json({ transferred: req.body.amount })
  })

app.listen(3001)
`,
    l1: true,
    funds: true,
    write: true,
    read: true,
  },
];

const WRONG: Case[] = [
  {
    label: 'transfer:funds only in comments',
    source: server({
      before: `/* TODO: also require transfer:funds via requiredScopes('transfer:funds') */`,
      post: `// requiredScopes('transfer:funds') goes here later
${post(`checkJwt, requiredScopes('write:transfers')`)}`,
    }),
    l1: false,
    funds: false,
    write: true,
    read: true,
  },
  {
    label: 'transfer:funds on GET instead of POST',
    source: server({
      get: `app.get('/api/balance', checkJwt, requiredScopes('read:balance'), requiredScopes('transfer:funds'), (req, res) => {
  res.json({ balance: 4200 });
});`,
      post: post(`checkJwt, requiredScopes('write:transfers')`),
    }),
    l1: true,
    funds: false,
    write: true,
    read: true,
  },
  {
    label: "requiredScopes('write:transfers', 'transfer:funds') on POST",
    source: server({ post: post(`checkJwt, requiredScopes('write:transfers', 'transfer:funds')`) }),
    l1: false,
    funds: false,
    write: true,
    read: true,
  },
  {
    label: 'global app.use(requiredScopes)',
    source: server({
      before: `app.use(requiredScopes('transfer:funds'));`,
      post: post(`checkJwt, requiredScopes('write:transfers')`),
    }),
    l1: true,
    funds: false,
    write: true,
    read: true,
  },
  {
    label: 'requiredScopes after the handler',
    source: server({
      post: `${post(`checkJwt, requiredScopes('write:transfers')`)}
app.use(requiredScopes('transfer:funds'));`,
    }),
    l1: true,
    funds: false,
    write: true,
    read: true,
  },
];

describe('express_api_mfa graders', () => {
  const makeDir = makeTmpDir('mfa_express_');

  beforeAll(() => {
    setFrameworkConfig(DEFAULT_FRAMEWORK_CONFIG);
  });

  async function grade(source: string | null, withEnv: boolean) {
    const dir = makeDir();
    cpSync(SCAFFOLD_DIR, dir, { recursive: true });
    if (source !== null) writeFileSync(join(dir, 'server.js'), source);
    const compileResult = runCompileCommand(dir, 'node --check server.js');
    const toolCalls = withEnv ? [ENV_CALL] : [];
    const graders = defineGraders().filter((g) => g.kind !== 'judge');
    const results = await runGraders(graders, dir, '', undefined, AGENT_LEVELS, true, toolCalls, compileResult);
    const byName = new Map(results.map((r) => [r.name, r.passed]));
    const get = (name: string): boolean => {
      const passed = byName.get(name);
      if (passed === undefined) throw new Error(`grader not found: ${name}`);
      return passed;
    };
    return { results, get };
  }

  const expectScopeGraders = (get: (n: string) => boolean, c: Case) => {
    expect(get(L1), 'L1 transfer:funds').toBe(c.l1);
    expect(get(FUNDS), 'FUNDS').toBe(c.funds);
    expect(get(WRITE), 'WRITE').toBe(c.write);
    expect(get(READ), 'READ').toBe(c.read);
  };

  it('untouched scaffold fails the scope graders but compiles and has no hallucinations', async () => {
    const { results, get } = await grade(null, false);
    expectScopeGraders(get, { label: '', source: null, l1: false, funds: false, write: false, read: false });
    expect(get(ENV_WRITTEN)).toBe(false);
    expect(get(COMPILES)).toBe(true);
    const others = results.filter((r) =>
      ['hallucination', 'security', 'version_correctness'].includes(String(r.level)),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) expect(r.passed, r.name).toBe(true);
  });

  it('reference solution passes every non-judge grader', async () => {
    const { results } = await grade(REFERENCE, true);
    for (const r of results) expect(r.passed, `${r.name}: ${r.detail}`).toBe(true);
  });

  describe('valid solutions pass all four scope graders', () => {
    it.each(VALID)('$label', async (c) => {
      const { get } = await grade(c.source, true);
      expect(get(COMPILES)).toBe(true);
      expectScopeGraders(get, c);
    });
  });

  describe('wrong solutions are rejected', () => {
    it.each(WRONG)('$label', async (c) => {
      const { get } = await grade(c.source, true);
      expect(get(COMPILES)).toBe(true);
      expectScopeGraders(get, c);
    });
  });

  it('PROMPT.md Task section does not leak the answer', () => {
    const prompt = readFileSync(join(EVAL_DIR, 'PROMPT.md'), 'utf-8');
    const task = prompt.split('## Task')[1];
    expect(task).toBeDefined();
    for (const leaked of ['403', 'insufficient_scope', 'existing', 'requiredScopes']) {
      expect(task).not.toContain(leaked);
    }
  });
});
