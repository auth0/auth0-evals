/**
 * Copilot SDK agent runner.
 *
 * Uses @github/copilot-sdk to drive Copilot programmatically via JSON-RPC
 * instead of spawning the CLI subprocess and parsing JSONL output by hand.
 * The SDK manages the CLI process lifecycle, so all we do here is:
 *   1. Create a session with the right config (model, MCP, skills, permissions).
 *   2. Register event handlers that populate the RunRecord.
 *   3. Send the prompt and wait for the session to go idle.
 *   4. Clean up.
 *
 * Skills are delivered via the SDK's `skillDirectories` config option —
 * files are pre-copied to `.github/skills/` by CopilotSdkSkillsStrategy
 * in strategy.ts, and the SDK's native discovery picks them up.
 */

import { join } from 'node:path';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type { MCPRemoteServerConfig } from '@github/copilot-sdk';
import type { EvalDefinition } from '../../../runners/loader.js';
import { COPILOT_TASK_TIMEOUT_MS } from '../../../config/settings.js';
import { estimateCost } from '../../../config/costs.js';
import type { RunRecord, ToolCallRecord, TurnMetric } from '../../agent-types.js';
import { classifyActionType, classifyErrorCategory, detectRetry } from '../../agent-types.js';
import { CopilotCliTranslator } from '../../tool-translator.js';
import { logger } from '../../../utils/logger.js';
import { makeSessionId } from '../../../utils/session.js';

const translator = new CopilotCliTranslator();

/** Model identifier written to RunRecord when Copilot SDK runner is used. */
export const COPILOT_MODEL_ID = 'copilot';

/** Default GPT model used when no explicit model is requested. */
export const COPILOT_DEFAULT_MODEL = 'gpt-5.4';

export interface CopilotRunOptions {
  /** Path to the `copilot` binary. Defaults to the bundled CLI from @github/copilot. */
  copilotBin?: string;
  /** Extra env vars forwarded to the CLI process. */
  env?: Record<string, string>;
  /** Tool flags from the eval runner (e.g. `['mcp', 'skills']`). */
  tools?: string[];
  /** Optional model identifier to request from Copilot. */
  model?: string;
}

/** Returns MCP server config for the Auth0 docs server. */
export function getMcpServers(): Record<string, MCPRemoteServerConfig> {
  return {
    'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp', tools: ['*'] },
  };
}

interface PendingToolCall {
  name: string;
  args: Record<string, unknown>;
  startTime: number;
}

function eventTimeSeconds(timestamp: string | undefined): number {
  if (!timestamp) return Date.now() / 1000;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms / 1000 : Date.now() / 1000;
}

/**
 * Runs a Copilot SDK agent against an eval definition and returns a RunRecord.
 */
export async function runCopilotAgent(
  evalDef: Pick<EvalDefinition, 'id' | 'userPrompt'>,
  workspace: string,
  opts: CopilotRunOptions = {},
): Promise<RunRecord> {
  const { copilotBin, env = {}, tools = [], model } = opts;

  const record: RunRecord = {
    taskName: evalDef.id,
    model: COPILOT_MODEL_ID,
    sessionId: makeSessionId(),
    startTime: Date.now() / 1000,
    endTime: 0,
    toolCalls: [],
    turnMetrics: [],
    providerErrors: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    status: 'running',
    finalSummary: '',
    workspace,
  };

  // Mutable turn state captured by event handler closures.
  let turnNum = 0;
  let prevTurnEndTime = record.startTime;
  const pending = new Map<string, PendingToolCall>();

  const client = new CopilotClient({
    ...(copilotBin ? { cliPath: copilotBin } : {}),
    cwd: workspace,
    env: { ...process.env, ...env },
    // useLoggedInUser defaults to true — the Copilot CLI picks up auth from
    // the gh CLI's stored credentials (set via `gh auth login` in CI).
  });

  logger.info(`\n[Copilot] Starting task: ${evalDef.id}`);
  logger.info(`[Copilot] Workspace: ${workspace}`);
  if (model) {
    logger.info(`[Copilot] Model: ${model}`);
  }
  if (tools.includes('mcp')) logger.info('[Copilot] MCP: https://auth0.com/docs/mcp');
  if (tools.includes('skills')) logger.info('[Copilot] Skills: .github/skills/');

  const session = await client.createSession({
    model,
    workingDirectory: workspace,
    // Do not pass agentSystemPrompt — that is a ReAct-specific prompt with
    // tool names (list_files, write_file, finish_task) that don't exist in
    // the Copilot CLI. The CLI manages its own system prompt.
    onPermissionRequest: approveAll,
    // Suppress ask_user to prevent eval runs from blocking on interactive input.
    excludedTools: ['ask_user'],
    ...(tools.includes('mcp') ? { mcpServers: getMcpServers() } : {}),
    // Skill files are pre-copied to .github/skills/ by CopilotSdkSkillsStrategy.
    ...(tools.includes('skills') ? { skillDirectories: [join(workspace, '.github', 'skills')] } : {}),
    // Disable infinite sessions — each eval run is a clean, isolated session.
    infiniteSessions: { enabled: false },
  });

  record.sessionId = session.sessionId;

  // Capture the resolved model once Copilot reports it.
  session.on('session.tools_updated', (ev) => {
    if (ev.data.model) {
      record.model = `${COPILOT_MODEL_ID}/${ev.data.model}`;
      logger.info(`[Copilot] Model resolved: ${record.model}`);
    }
  });

  // Each assistant.message is one LLM turn — record token usage and timing.
  session.on('assistant.message', (ev) => {
    try {
      const msg = ev.data;
      const now = eventTimeSeconds(ev.timestamp);
      turnNum++;
      const toolCallCount = msg.toolRequests?.length ?? 0;

      const turnMetric: TurnMetric = {
        turn: turnNum,
        inputTokens: 0,
        outputTokens: 0,
        llmLatency: Math.max(0, now - prevTurnEndTime),
        finishReason: toolCallCount > 0 ? 'tool_calls' : 'stop',
        toolCallCount,
        costUsd: 0,
      };
      record.turnMetrics.push(turnMetric);

      if (toolCallCount === 0 && msg.content?.trim()) {
        record.finalSummary = msg.content.trim();
      }

      logger.info(`[Copilot] Turn ${turnNum}: ${toolCallCount} tool(s), finish=${turnMetric.finishReason}`);
    } catch (e) {
      record.providerErrors.push(`assistant.message handler error: ${e}`);
    }
  });

  // Track when each turn ends to compute LLM latency for the next turn.
  session.on('assistant.turn_end', (ev) => {
    prevTurnEndTime = eventTimeSeconds(ev.timestamp);
  });

  // assistant.usage fires once per LLM API call with authoritative token counts.
  // Use per-token cost estimation (same strategy as other runners).
  session.on('assistant.usage', (ev) => {
    const u = ev.data;
    const inputTokens = u.inputTokens ?? 0;
    const outputTokens = u.outputTokens ?? 0;

    record.inputTokens += inputTokens;
    record.outputTokens += outputTokens;

    // Strip "copilot/" prefix to look up the model in the cost table.
    const modelKey = record.model.replace(/^copilot\//, '');
    const callCost = estimateCost(modelKey, inputTokens, outputTokens);
    record.costUsd += callCost;

    // assistant.usage fires after assistant.message — backfill the latest TurnMetric
    // with authoritative per-call token counts and cost.
    const latest = record.turnMetrics[record.turnMetrics.length - 1];
    if (latest) {
      latest.inputTokens = inputTokens;
      latest.outputTokens = outputTokens;
      latest.costUsd = callCost;
      logger.info(
        `[Copilot] Turn ${latest.turn}: ${inputTokens}in/${outputTokens}out tokens, cost=$${callCost.toFixed(4)}`,
      );
    }
  });

  // Record the start of each tool call so we can match it with its result.
  session.on('tool.execution_start', (ev) => {
    pending.set(ev.data.toolCallId, {
      name: ev.data.toolName,
      args: (ev.data.arguments as Record<string, unknown>) ?? {},
      startTime: eventTimeSeconds(ev.timestamp),
    });
  });

  // Finalise each tool call record once the result arrives.
  session.on('tool.execution_complete', (ev) => {
    try {
      const now = eventTimeSeconds(ev.timestamp);
      const pend = pending.get(ev.data.toolCallId);
      if (pend) pending.delete(ev.data.toolCallId);

      if (ev.data.model && record.model === COPILOT_MODEL_ID) {
        record.model = `${COPILOT_MODEL_ID}/${ev.data.model}`;
      }

      if (!pend) {
        record.providerErrors.push(`orphaned tool result: id=${ev.data.toolCallId} (start event missing)`);
        return;
      }

      if (translator.isInternalTool(pend.name)) return;

      const mappedName = translator.mapName(pend.name);
      const toolArgs = translator.normalizeArgs(pend.name, pend.args);
      const isError = ev.data.success !== true;
      const resultText = isError
        ? (ev.data.error?.message ?? '<error>')
        : (ev.data.result?.content ?? ev.data.result?.detailedContent ?? '<ok>');

      const isRetry = detectRetry(record.toolCalls, mappedName, toolArgs);
      const recovered = isRetry && !isError;

      const tc: ToolCallRecord = {
        name: mappedName,
        args: toolArgs,
        result: resultText,
        startTime: pend.startTime,
        endTime: now,
        isDocLookup: translator.isDocLookup(pend.name),
        isInterruption: translator.isInterruption(pend.name),
        causedError: isError,
        actionType: classifyActionType(mappedName, isError),
        isRetry,
        recoveredFromError: recovered,
      };

      if (isError) {
        tc.errorCategory = classifyErrorCategory(resultText);
        record.providerErrors.push(`${mappedName}: ${resultText.slice(0, 200)}`);
      }

      record.toolCalls.push(tc);
    } catch (e) {
      record.providerErrors.push(`tool.execution_complete handler error: ${e}`);
    }
  });

  try {
    const lastMessage = await session.sendAndWait({ prompt: evalDef.userPrompt }, COPILOT_TASK_TIMEOUT_MS);
    if (lastMessage && !record.finalSummary) {
      record.finalSummary = lastMessage.data?.content ?? '';
    }
    record.status = 'success';
  } catch (err) {
    const msg = String(err);
    record.providerErrors.push(`task error: ${msg}`);
    record.status = 'failure';
    logger.info(`[Copilot] ✗ Task failed: ${msg}`);
    if (msg.toLowerCase().includes('timeout')) {
      logger.info(`[Copilot] ✗ Timeout after ${COPILOT_TASK_TIMEOUT_MS / 1000}s — aborting session`);
      try {
        await session.abort();
      } catch (abortErr) {
        logger.warn(`[Copilot] ⚠ session.abort() failed: ${abortErr}`);
      }
    }
  } finally {
    // Drain tool calls that never received a completion event (e.g. on timeout).
    const now = Date.now() / 1000;
    for (const [id, pend] of pending) {
      if (translator.isInternalTool(pend.name)) continue;
      const mappedName = translator.mapName(pend.name);
      const toolArgs = translator.normalizeArgs(pend.name, pend.args);
      record.toolCalls.push({
        name: mappedName,
        args: toolArgs,
        result: '<orphaned: result event never received>',
        startTime: pend.startTime,
        endTime: now,
        isDocLookup: translator.isDocLookup(pend.name),
        isInterruption: translator.isInterruption(pend.name),
        causedError: true,
        actionType: classifyActionType(mappedName, true),
        isRetry: detectRetry(record.toolCalls, mappedName, toolArgs),
        recoveredFromError: false,
        errorCategory: 'unknown',
      });
      record.providerErrors.push(`orphaned tool call: ${pend.name} (id=${id})`);
      logger.info(`[Copilot] ⚠ Orphaned tool call: ${pend.name} (id=${id})`);
    }
    pending.clear();

    record.endTime = Date.now() / 1000;
    try {
      await session.disconnect();
    } catch (e) {
      logger.warn(`[Copilot] ⚠ session.disconnect() failed: ${e}`);
    }
    try {
      await client.stop();
    } catch (e) {
      logger.warn(`[Copilot] ⚠ client.stop() failed: ${e}`);
    }

    logger.info(
      `[Copilot] Done — status=${record.status} turns=${turnNum} ` +
        `tools=${record.toolCalls.length} cost=$${record.costUsd.toFixed(4)}`,
    );
  }

  return record;
}
