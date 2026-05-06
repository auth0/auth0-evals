#!/usr/bin/env node
/**
 * Reads .md prompt files from src/graders/prompts/ and generates
 * src/graders/prompts.ts with the content embedded as string constants.
 *
 * Run before tsc so the generated file is compiled with everything else.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'src', 'graders', 'prompts');
const outFile = join(__dirname, '..', 'src', 'graders', 'prompts.generated.ts');

const files = readdirSync(promptsDir).filter((f) => f.endsWith('.md'));

const frameworkEntries = [];
let userTemplate = '';

for (const file of files) {
  const content = readFileSync(join(promptsDir, file), 'utf-8').trim();
  const name = basename(file, '.md');

  if (name === 'user_template') {
    userTemplate = content;
  } else {
    frameworkEntries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(content)},`);
  }
}

const output = `/**
 * Auto-generated from src/graders/prompts/*.md — do not edit manually.
 * Run: node scripts/generate-prompts.mjs
 */

/** Framework-specific system prompts keyed by framework name. */
export const FRAMEWORK_PROMPTS: Record<string, string> = {
${frameworkEntries.join('\n')}
};

/** User message template. Placeholders: \`{question}\`, \`{code}\`. */
export const USER_TEMPLATE = ${JSON.stringify(userTemplate)};
`;

writeFileSync(outFile, output, 'utf-8');
console.log(`Generated ${outFile} from ${files.length} prompt files`);
