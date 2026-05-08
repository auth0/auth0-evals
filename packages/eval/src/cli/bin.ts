#!/usr/bin/env node
import { runCli } from './run.js';

runCli().catch((e) => {
  console.error(e);
  process.exit(1);
});
