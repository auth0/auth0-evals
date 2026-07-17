/**
 * Test helper — initialises the FrameworkConfig singleton with values
 * so tests that read from getFrameworkConfig() work.
 *
 * Side-effect import: `import './setup-config.js'` — sets the singleton.
 * Named import: `import { TEST_CONFIG } from './setup-config.js'` — re-exports the config object.
 */

import { setFrameworkConfig } from '@a0/evals-core';
export { TEST_CONFIG } from './test-config.js';
import { TEST_CONFIG } from './test-config.js';

setFrameworkConfig(TEST_CONFIG);
