#!/usr/bin/env node
/**
 * Reads prompt .md files from src/graders/prompts/ and generates
 * src/graders/prompts.generated.ts with the content embedded as string constants.
 *
 * Run before tsc so the generated file is compiled with everything else.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'src', 'graders', 'prompts');
const outFile = join(__dirname, '..', 'src', 'graders', 'prompts.generated.ts');

const systemPrompt = readFileSync(join(promptsDir, 'default.md'), 'utf-8').trim();
const userTemplate = readFileSync(join(promptsDir, 'user_template.md'), 'utf-8').trim();

const output = `/**
 * Auto-generated from src/graders/prompts/*.md — do not edit manually.
 * Run: node scripts/generate-prompts.mjs
 */

/** Judge system prompt. */
export const SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)};

/** User message template. Placeholders: \`{question}\`, \`{code}\`. */
export const USER_TEMPLATE = ${JSON.stringify(userTemplate)};
`;

writeFileSync(outFile, output, 'utf-8');
console.log(`Generated ${outFile}`);
