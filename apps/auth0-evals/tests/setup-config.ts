/**
 * Test helper — initialises the FrameworkConfig singleton with Auth0-specific
 * values so tests that read from getFrameworkConfig() work.
 *
 * Side-effect import: `import './setup-config.js'` — sets the singleton.
 * Named import: `import { TEST_CONFIG } from './setup-config.js'` — re-exports the config object.
 *
 * For tests that use vi.resetModules() (which wipes the singleton), use vi.mock
 * with test-config.ts instead (see agent.test.ts, tools.test.ts, skills.test.ts).
 */

import { setFrameworkConfig } from '../src/config/framework-config.js';
import { setFrameworkConfig as setPackageFrameworkConfig } from '@a0/eval';
export { TEST_CONFIG } from './test-config.js';
import { TEST_CONFIG } from './test-config.js';

setFrameworkConfig(TEST_CONFIG);
setPackageFrameworkConfig(TEST_CONFIG);
