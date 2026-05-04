import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool, ToolResult } from '../tools/base.js';
import { ALL_BASE_TOOLS } from '../tools/index.js';
import { logger } from '@a0/eval';

export interface McpConfig {
  url: string;
  version: string;
  name: string;
}
/**
 * ToolExecutor is responsible for executing tools based on their name and provided arguments.
 * It maintains a workspace and credentials that can be used by the tools during execution.
 * Call initMcp() once per MCP server to connect and register its tools; call close() when done.
 */
export class ToolExecutor {
  readonly #workspace: string;
  readonly #credentials: Record<string, string>;
  readonly #tools: Tool[];
  #mcpClients: Client[] = [];
  readonly #mcpToolToClient: Map<string, Client> = new Map();

  constructor(workspace: string, credentials: Record<string, string> = {}) {
    try {
      this.#workspace = realpathSync(workspace);
    } catch {
      this.#workspace = resolve(workspace);
    }
    this.#credentials = credentials;
    this.#tools = [...ALL_BASE_TOOLS];
  }

  /**
   * Connects to an MCP server, lists its tools, and registers them for routing.
   * Can be called multiple times to connect to different MCP servers.
   * Returns the tool definitions in OpenAI function format for passing to the LLM.
   */
  async initMcp(config: McpConfig): Promise<{ tools: unknown[]; toolNames: string[] }> {
    const { url, version, name } = config;

    logger.info(`\n[MCP] Connecting to MCP server '${url}'...`);

    const client = new Client({ name: name, version: version });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { signal: AbortSignal.timeout(30_000) },
    });
    await client.connect(transport);
    const { tools } = await client.listTools();

    logger.info(`[MCP] Connected to '${url}'. Available tools: ${tools.map((t) => t.name).join(', ')}`);

    const localToolNames = new Set<string>(this.#tools.map((t) => t.name));
    const conflicts = tools.map((t) => t.name).filter((n) => this.#mcpToolToClient.has(n) || localToolNames.has(n));
    if (conflicts.length > 0) {
      await client.close();
      throw new Error(`MCP tool name conflicts with already-registered tools: ${conflicts.join(', ')}`);
    }

    this.#mcpClients.push(client);
    for (const tool of tools) {
      this.#mcpToolToClient.set(tool.name, client);
    }

    return {
      toolNames: tools.map((t) => t.name),
      tools: tools.map((t) => {
        // Strip $schema — Vertex AI / Gemini rejects unknown top-level keys
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { $schema: _, ...parameters } = t.inputSchema as Record<string, unknown>;
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description ?? '',
            parameters,
          },
        };
      }),
    };
  }

  /** Closes all open MCP connections. */
  async close(): Promise<void> {
    await Promise.all(this.#mcpClients.map((c) => c.close()));
    this.#mcpClients = [];
    this.#mcpToolToClient.clear();
  }

  /**
   * Executes a tool by its name with the given arguments.
   * Local tools are executed directly; tools registered via initMcp() are routed to the MCP client.
   * @param name The name of the tool to execute.
   * @param args The arguments to pass to the tool during execution.
   * @returns A tuple containing the tool's output, a boolean indicating isDoc, a boolean indicating if there was an interruption, and a boolean indicating if there was an error.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const tool = this.#tools.find((t) => t.name === name);

      if (tool) {
        const toolContext = { workspace: this.#workspace, credentials: this.#credentials };
        return await tool.run(toolContext, args);
      }

      const mcpClient = this.#mcpToolToClient.get(name);
      if (mcpClient) {
        const argsPreview = JSON.stringify(args).slice(0, 120);
        logger.info(`[MCP] Calling tool: ${name}(${argsPreview})`);
        const result = await mcpClient.callTool({ name, arguments: args });
        if (result.isError) {
          logger.error(`[MCP] Tool ${name} returned an error`);
          return [`MCP error: ${JSON.stringify(result.content).slice(0, 500)}`, false, false, true];
        }
        const text = (result.content as { type: string; text: string }[])
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        logger.info(`[MCP] Tool ${name} returned ${text.length} chars`);
        return [text.slice(0, 3000).trim() || '(no results)', true, false, false];
      }

      return [`Unknown tool: ${name}`, false, false, true];
    } catch (e) {
      return [`Error executing ${name}: ${e}`, false, false, true];
    }
  }
}
