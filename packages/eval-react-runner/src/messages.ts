/**
 * Message construction helpers for the ReAct agent runner.
 *
 * Responsible for building prompt and message objects: system prompt,
 * workspace context, MCP context, and tool result messages.
 */

import { collectFiles, isGeminiModel } from '@a0/eval-core';
import type { TaskDefinition } from './agent.js';

/**
 * Builds a structured XML block describing the current workspace state.
 * Injected into the system message alongside the agent's stable instructions,
 * following Copilot's Layer 2 pattern: dynamic environment context that is
 * specific to this session without polluting the stable rule set.
 */
export function buildWorkspaceContext(workspace: string): string {
  const files = collectFiles(workspace, workspace);
  const fileList = files.length > 0 ? files.map((f) => `  ${f}`).join('\n') : '  (empty workspace)';
  return `<workspace>
The project workspace contains the following files:
${fileList}

All file paths in tool calls must be relative to this workspace root.
</workspace>`;
}

/**
 * Builds an MCP context block listing available tools from registered MCP servers.
 * @param toolNames An array of tool names to include in the context block.
 * @returns A formatted string containing the MCP context, or an empty string if no tools are provided.
 */
export function buildMcpContext(toolNames: string[] = []): string {
  const list = toolNames.map((n) => `- ${n}`).join('\n');

  // When there are no tools, omit the context altogether.
  if (list.length === 0) {
    return '';
  }

  return `<mcp_tools>
You have direct access to the following tools from the registered MCP server(s):
${list}

Always call these tools first when you need documentation, API details, or SDK usage examples.
Prefer them over fetch_url.
</mcp_tools>`;
}

/**
 * Builds the initial messages array for the agent loop.
 * Handles MCP table row injection into system prompt, workspace context, and MCP context.
 */
export function buildInitialMessages(
  task: TaskDefinition,
  tools: string[],
  mcpToolDefs: unknown[],
  workspace: string,
): unknown[] {
  const messages: unknown[] = [];
  if (task.agentSystemPrompt) {
    // Layer 1 (stable rules) + Layer 2 (dynamic workspace context) combined in system message
    const mcpTableRows = mcpToolDefs
      .map((t) => {
        const def = t as { function: { name: string; description: string } };
        return `| \`${def.function.name}\` | ${def.function.description} |`;
      })
      .join('\n');
    const systemPrompt = task.agentSystemPrompt.replace('{{MCP_TOOL_ROWS}}', mcpTableRows);
    const workspaceContext = buildWorkspaceContext(workspace);
    const mcpToolNames = mcpToolDefs.map((t) => (t as { function: { name: string } }).function.name);
    const mcpContextBody = tools.includes('mcp') ? buildMcpContext(mcpToolNames) : '';
    const mcpContext = mcpContextBody ? `\n\n${mcpContextBody}` : '';
    messages.push({ role: 'system', content: `${systemPrompt}\n\n${workspaceContext}${mcpContext}` });
  }
  messages.push({ role: 'user', content: task.userPrompt });
  return messages;
}

/**
 * Builds the correctly-shaped tool result message to push onto the history.
 *
 * When usedXmlFallback is true the model returned raw XML tool calls embedded in
 * its content (no tool_call_id to reference), so we use a plain user message.
 * For all other paths — including Bedrock models that return native tool_calls
 * via litellm — we use role:"tool" with the tool_call_id so litellm can map it
 * to a Bedrock tool_result block correctly.
 */
export function buildToolResultMessage(
  model: string,
  tcId: string,
  toolName: string,
  result: string,
  usedXmlFallback: boolean = false,
): unknown {
  if (usedXmlFallback) {
    // XML-fallback path: no tool_call_id exists, results must be plain user messages.
    return { role: 'user', content: `[Result of ${toolName}]:\n${result}` };
  } else if (isGeminiModel(model)) {
    return { role: 'function', name: toolName, content: result };
  } else {
    // Standard path (including Bedrock via litellm): role:"tool" lets litellm
    // convert this to a Bedrock tool_result block.
    return { role: 'tool', tool_call_id: tcId, content: result };
  }
}
