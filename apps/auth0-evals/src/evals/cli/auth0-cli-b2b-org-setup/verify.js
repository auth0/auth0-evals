// Ground-truth verification for the `auth0_cli_b2b_org_setup` eval.
//
// This lives beside the eval it checks (PROMPT.md / graders.ts) and is wired in
// by that eval's harness.json (`"verify": "verify.js"`), because its assertions
// ARE the eval's acceptance criteria — it is not a generic tool. The framework
// never runs or compiles it (the loader only reads PROMPT.md and graders.ts, and
// tsc's include is `src/**/*.ts`), so a plain .js sitting here is inert to
// discovery and the build. It is meant for a runner that provisions a live
// Auth0 tenant for the eval; a runner with no live environment simply ignores it.
//
// A runner invokes this against the still-live tenant after the agent finishes
// but before teardown. It queries the Management API through the already-logged-in
// `auth0` CLI and asserts the full B2B graph the prompt asked for actually exists
// on the server — not in the agent's manifest, on the server. This catches a
// manifest that claims success while the tenant is empty (or half-configured),
// which neither the trace graders nor the file/trace judge can rule out on their own.
//
// It is intentionally decoupled from the eval score: it prints a PASS/FAIL report
// and exits non-zero on any missing/mismatched resource, so a runner can log that
// out-of-band and tear the tenant down regardless. It is also never shown to the
// agent, so it does not leak acceptance criteria into the goal-only prompt.
//
// Environment: `AUTH0_CLI_PATH` optionally points at the `auth0` binary; the CLI's
// stored config must already target the tenant under test, so a bare `auth0 api …`
// resolves against it.

import { spawnSync } from 'node:child_process';

const BIN = process.env.AUTH0_CLI_PATH || 'auth0';

const API_IDENTIFIER = 'https://smoke.example.com';
const API_SCOPES = ['read:reports', 'write:reports', 'manage:members'];

// Query the Management API through the CLI. `auth0 api get <path>` prints the raw
// JSON response, which the CLI auto-authenticates using the stored config.
function api(path) {
  const r = spawnSync(BIN, ['api', 'get', path], { encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`auth0 api get ${path} failed (exit ${r.status ?? 'null'}): ${(r.stderr || '').trim()}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`auth0 api get ${path} did not return JSON: ${r.stdout.slice(0, 200)}`);
  }
}

// Management API list endpoints answer either a bare array or a wrapped object
// (e.g. { clients: [...] }) depending on pagination params. Normalize both.
function asList(res, key) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res[key])) return res[key];
  return [];
}

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

function hasAll(haystack, needles) {
  return needles.every((n) => haystack.includes(n));
}

function main() {
  console.log('── Live tenant B2B verification ──────────────────────────────');

  // 1. Protected API with the three scopes.
  const resourceServers = asList(api('resource-servers'), 'resource_servers');
  const smokeApi = resourceServers.find((rs) => rs.identifier === API_IDENTIFIER);
  check('API "Smoke API" exists with identifier ' + API_IDENTIFIER, !!smokeApi);
  const apiScopeValues = (smokeApi?.scopes || []).map((s) => s.value);
  check(
    'API exposes read/write/manage scopes',
    hasAll(apiScopeValues, API_SCOPES),
    `got [${apiScopeValues.join(', ')}]`,
  );

  // 2. Two roles with permissions wired to the API scopes.
  const roles = asList(api('roles'), 'roles');
  const orgAdmin = roles.find((r) => r.name === 'Org Admin');
  const orgMember = roles.find((r) => r.name === 'Org Member');
  check('Role "Org Admin" exists', !!orgAdmin);
  check('Role "Org Member" exists', !!orgMember);

  if (orgAdmin) {
    const perms = asList(api(`roles/${orgAdmin.id}/permissions`), 'permissions').map((p) => p.permission_name);
    check('Org Admin has all three API permissions', hasAll(perms, API_SCOPES), `got [${perms.join(', ')}]`);
  }
  if (orgMember) {
    const perms = asList(api(`roles/${orgMember.id}/permissions`), 'permissions').map((p) => p.permission_name);
    check('Org Member has read:reports', perms.includes('read:reports'), `got [${perms.join(', ')}]`);
  }

  // 3. Two applications of the right type.
  const clients = asList(api('clients'), 'clients');
  const portal = clients.find((c) => c.name === 'Smoke Portal');
  const automation = clients.find((c) => c.name === 'Smoke Automation');
  check('App "Smoke Portal" is a regular web app', portal?.app_type === 'regular_web', `app_type=${portal?.app_type}`);
  check(
    'App "Smoke Automation" is a machine-to-machine app',
    automation?.app_type === 'non_interactive',
    `app_type=${automation?.app_type}`,
  );

  // 4. M2M client grant: Smoke Automation -> Smoke API with the two scopes.
  if (automation) {
    const grants = asList(api(`client-grants?client_id=${automation.client_id}`), 'client_grants');
    const grant = grants.find((g) => g.audience === API_IDENTIFIER);
    check('M2M client grant exists for Smoke Automation -> Smoke API', !!grant);
    check(
      'M2M grant includes read:reports and manage:members',
      hasAll(grant?.scope || [], ['read:reports', 'manage:members']),
      `got [${(grant?.scope || []).join(', ')}]`,
    );
  }

  // 5. Two organizations, each with an enabled connection.
  const orgs = asList(api('organizations'), 'organizations');
  for (const [slug, display] of [
    ['acme', 'Acme Inc'],
    ['globex', 'Globex Corp'],
  ]) {
    const org = orgs.find((o) => o.name === slug);
    check(
      `Organization "${slug}" exists with display name "${display}"`,
      org?.display_name === display,
      `display_name=${org?.display_name}`,
    );
    if (org) {
      const enabled = asList(api(`organizations/${org.id}/enabled_connections`), 'enabled_connections');
      check(`Organization "${slug}" has an enabled login connection`, enabled.length > 0);
    }
  }

  // 6. Org-admin invitation into acme.
  const acme = orgs.find((o) => o.name === 'acme');
  if (acme) {
    const invitations = asList(api(`organizations/${acme.id}/invitations`), 'invitations');
    const invite = invitations.find((i) => i.invitee?.email === 'admin@acme.example.com');
    check('Invitation for admin@acme.example.com exists on acme', !!invite);
  }

  console.log('──────────────────────────────────────────────────────────────');
  if (failures.length === 0) {
    console.log('All B2B resources verified on the live tenant.');
    process.exit(0);
  }
  console.error(`${failures.length} check(s) failed: ${failures.join('; ')}`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`Verification errored: ${err.message}`);
  process.exit(1);
}
