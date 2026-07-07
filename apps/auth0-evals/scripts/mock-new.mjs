#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: mock:new <surface>');
  console.error('');
  console.error('Creates:');
  console.error('  mocks/<surface>.routes.json (manifest)');
  console.error('  mocks/fixtures/<surface>/example.json (fixture)');
  console.error('  mocks/<surface>.handlers.js (handler stub)');
  process.exit(1);
}

const surface = args[0];
const mockDir = join(cwd, 'mocks');
const fixturesDir = join(mockDir, 'fixtures', surface);

// Create fixtures directory
mkdirSync(fixturesDir, { recursive: true });

// Create manifest
const manifest = {
  surface,
  routes: [
    {
      match: 'POST /api/v2/example',
      verb: 'create',
      state: 'example.created',
      body: 'example.json',
    },
    {
      match: 'GET /api/v2/example',
      verb: 'reflect',
      state: 'example.created',
      body: 'example.json',
    },
    {
      match: 'DELETE /api/v2/example',
      verb: 'static',
      body: {},
    },
  ],
};
writeFileSync(join(mockDir, `${surface}.routes.json`), JSON.stringify(manifest, null, 2));

// Create example fixture
const fixture = { id: 'example_id', name: 'Example Resource' };
writeFileSync(join(fixturesDir, 'example.json'), JSON.stringify(fixture, null, 2));

// Create handlers stub
const handlers = `export default {
  // Add custom handler functions here
  // Example: exampleHandler: async (ctx) => ({ id: 'test' })
};
`;
writeFileSync(join(mockDir, `${surface}.handlers.js`), handlers);

console.log(`Created ${surface} mock scaffold in mocks/`);
