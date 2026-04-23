import { Tool, ToolContext, ToolName, ToolResult } from './base.js';

function wrapResult(message: string): ToolResult {
  return [message, true, false, false];
}

/**
 * FetchUrlTool allows the agent to fetch the content of a URL.
 * It uses Node's built-in fetch API to retrieve the content of the specified URL, with a custom User-Agent header and a timeout.
 * The tool returns the fetched content as plain text, stripping out any HTML tags.
 * If there is an error during fetching, it returns an appropriate error message.
 */
export class FetchUrlTool implements Tool {
  name: ToolName = 'fetch_url';

  async run(_context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const url = args.url as string;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'auth0-eval-agent/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const snippet = (await response.text())
          .replace(/<[^>]+>/g, ' ')
          .trim()
          .slice(0, 200);
        return wrapResult(
          `Could not fetch ${url}: ${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`,
        );
      }
      const text = (await response.text()).replace(/<[^>]+>/g, ' ').replace(/\s{3,}/g, '\n');
      return wrapResult(text.slice(0, 3000).trim());
    } catch (e) {
      return wrapResult(`Could not fetch ${url}: ${e}`);
    }
  }
}
