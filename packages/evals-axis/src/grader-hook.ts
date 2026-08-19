/**
 * AXIS post-run grader hook.
 *
 * After an AXIS job completes (and before workspace teardown), this hook
 * loads the matching eval's graders, optionally runs the compile command,
 * and calls the auth0-evals grader engine against the workspace.
 */

import { discoverEvals, loadEval, runGraders, runCompileCommand, runSetupCommand, AGENT_LEVELS } from '@a0/evals-core';
import type { GraderResult } from '@a0/evals-graders';
import type { RunResult } from '@netlify/axis';
import { axisTranscriptToToolCalls } from './adapter.js';

export interface RunAuth0GradersOptions {
  /** Absolute path to the framework root (contains eval.config.js and src/evals/). */
  frameworkRoot: string;
  /** Relative path to the evals directory inside frameworkRoot. Defaults to 'src/evals'. */
  evalsDir?: string;
  /** LLM API key forwarded to the judge model. */
  apiKey: string;
  /** Judge model identifier. Falls back to the framework config judge model when omitted. */
  judgeModel?: string;
}

/**
 * Runs auth0-evals graders against a completed AXIS job.
 *
 * Discovers the eval matching result.scenarioKey, converts the AXIS transcript
 * to EventToolCall[], runs the compile command (and setup command, if declared)
 * or the setup command alone when there is no compile step, then grades the
 * workspace with L1-L4 graders (AGENT_LEVELS).
 */
export async function runAuth0Graders(result: RunResult, options: RunAuth0GradersOptions): Promise<GraderResult[]> {
  const { frameworkRoot, evalsDir = 'src/evals', apiKey, judgeModel } = options;

  if (!result.workingDirectory) {
    throw new Error(
      `workingDirectory missing in RunResult for '${result.scenarioKey}' — workspace was cleaned up before grading`,
    );
  }

  const evalConfigs = discoverEvals(evalsDir, frameworkRoot);
  const evalConfig = evalConfigs.find((c) => c.id === result.scenarioKey);
  if (!evalConfig) {
    throw new Error(`No eval found with id '${result.scenarioKey}' in ${frameworkRoot}/${evalsDir}`);
  }

  const evalDef = await loadEval(evalConfig, frameworkRoot);
  const toolCalls = axisTranscriptToToolCalls(result.output.transcript);

  let compileResult;
  if (evalDef.compileCommand) {
    compileResult = runCompileCommand(result.workingDirectory, evalDef.compileCommand, {
      setupCommand: evalDef.setupCommand,
    });
  } else if (evalDef.setupCommand) {
    runSetupCommand(result.workingDirectory, evalDef.setupCommand);
  }

  // result.output.result is the agent's final prose reply — pass it as agentText
  // so judge() and contains() work on MCP-only evals that write no files.
  const agentText = result.output.result ?? undefined;

  return runGraders(
    evalDef.graders,
    result.workingDirectory,
    apiKey,
    judgeModel,
    AGENT_LEVELS,
    true, // enforceMaxChars — truncate workspace to judge's 32 768-char limit
    toolCalls,
    compileResult,
    agentText,
  );
}
