#!/usr/bin/env node
/**
 * In-container entry point for Docker-sandboxed eval runs.
 *
 * Reads job parameters from environment variables (set by the host's Docker
 * lifecycle module), executes the eval job, and writes results to a JSON file
 * in the workspace for the host to read after the container exits.
 *
 * This script is NOT meant to be invoked directly — it is called by
 * docker/entrypoint.sh inside the sandbox container.
 */

import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';

import {
  loadEval,
  loadConfig,
  discoverEvals,
  setFrameworkConfig,
  runGraders,
  runSetupCommand,
  runCompileCommand,
  AGENT_LEVELS,
  AGENT_MCP_LEVELS,
  registerRunner,
  getRunner,
  logger,
  serialiseAgent,
  serialiseError,
} from '@a0/eval-core';
import type { AgentType } from '@a0/eval-core';
import { generateRunRecommendations } from '../recommendations/index.js';

import { LLM_API_KEY_ENV } from './constants.js';
import { score } from '../scorer.js';
import { ClaudeCodeRunner } from '../runners/claude-code/runner.js';
import { CopilotCliRunner } from '../runners/copilot/runner.js';
import { GeminiCliRunner } from '../runners/gemini-cli/runner.js';
import { CodexRunner } from '../runners/codex/runner.js';
import { SANDBOX_RESULTS_FILE } from './constants.js';

// ── Runner registration ──────────────────────────────────────────────────────

let runnersInitialised = false;

async function initRunners(): Promise<void> {
  if (runnersInitialised) return;
  runnersInitialised = true;

  registerRunner('claude-code', new ClaudeCodeRunner());
  registerRunner('copilot', new CopilotCliRunner());
  registerRunner('gemini-cli', new GeminiCliRunner());
  registerRunner('codex', new CodexRunner());
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Read job params from environment
  const evalId = process.env.EVAL_ID;
  const model = process.env.MODEL;
  const mode = process.env.MODE as 'agent' | undefined;
  const tools = (process.env.TOOLS || '').split(',').filter(Boolean);
  const agentType = process.env.AGENT_TYPE as AgentType | undefined;
  const apiKey = process.env[LLM_API_KEY_ENV];
  const workspace = process.env.WORKSPACE || '/workspace';

  // Validate required params
  if (!evalId) throw new Error('EVAL_ID environment variable is required');
  if (!model) throw new Error('MODEL environment variable is required');
  if (!mode) throw new Error('MODE environment variable is required');
  if (!agentType) throw new Error('AGENT_TYPE environment variable is required');
  if (!apiKey) throw new Error(`${LLM_API_KEY_ENV} environment variable is required`);

  // The framework root inside the container
  const frameworkRoot = '/app/apps/auth0-evals';

  // Load .env if present
  loadDotenv({ path: join(frameworkRoot, '.env') });

  // Load framework config
  const frameworkConfig = await loadConfig({ configPath: join(frameworkRoot, 'eval.config.js') });
  setFrameworkConfig(frameworkConfig);

  const evaluations = discoverEvals(frameworkConfig.evalsDir, frameworkRoot);
  if (evaluations.length === 0) {
    throw new Error('No evaluations found in evalsDir');
  }

  const evalConfig = evaluations.find((e) => e.id === evalId);
  if (!evalConfig) {
    throw new Error(`Unknown eval ID: ${evalId}`);
  }

  logger.info(`[sandbox] Running: ${evalId} / ${model} / ${mode} / tools=[${tools.join(',')}] / agent=${agentType}`);

  await initRunners();

  const evalDef = await loadEval(evalConfig, frameworkRoot);

  try {
    if (evalDef.setupCommand) {
      logger.info(`  [Setup] Running: ${evalDef.setupCommand}`);
      runSetupCommand(workspace, evalDef.setupCommand);
    }
    const runner = getRunner(agentType);
    const preparedEval = tools.includes('skills') ? await runner.prepareSkills(evalDef, workspace) : evalDef;
    const { record, resolvedModel } = await runner.run({ evalDef: preparedEval, workspace, model, tools, apiKey });

    const compileResult =
      evalDef.compileCommand !== undefined
        ? runCompileCommand(workspace, evalDef.compileCommand, { setupCommand: evalDef.setupCommand })
        : undefined;

    let graderResults: Awaited<ReturnType<typeof runGraders>> = [];
    if (evalDef.graders.length > 0) {
      const agentLevels = tools.includes('mcp') ? AGENT_MCP_LEVELS : AGENT_LEVELS;
      graderResults = await runGraders(
        evalDef.graders,
        workspace,
        apiKey,
        undefined,
        agentLevels,
        true,
        record.toolCalls,
        compileResult,
      );
    }

    const scored = score(record, graderResults);

    // Generate recommendations when skills or MCP are enabled
    const recommendations = await generateRunRecommendations(
      evalDef,
      resolvedModel,
      tools,
      workspace,
      scored,
      record,
      apiKey,
    );

    const result = {
      ...serialiseAgent(evalDef, record, scored, graderResults, resolvedModel, mode, tools, recommendations),
      agent_type: agentType,
    };

    // Write results atomically: write to .tmp then rename so the host never sees a partial file
    const resultsPath = join(workspace, SANDBOX_RESULTS_FILE);
    const tmpPath = resultsPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(result, null, 2), 'utf-8');
    renameSync(tmpPath, resultsPath);
    logger.info(`[sandbox] Results written to ${resultsPath}`);
  } catch (e) {
    const errorMsg = String(e);
    logger.error(`[sandbox] Error: ${errorMsg}`);

    const result = {
      ...serialiseError(evalId, evalDef.category, model, mode, tools, errorMsg),
      agent_type: agentType,
    };

    const resultsPath = join(workspace, SANDBOX_RESULTS_FILE);
    const tmpPath = resultsPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(result, null, 2), 'utf-8');
    renameSync(tmpPath, resultsPath);
    process.exit(1);
  }
}

main().catch((e) => {
  logger.error(`[sandbox] Fatal: ${e}`);
  process.exit(1);
});
