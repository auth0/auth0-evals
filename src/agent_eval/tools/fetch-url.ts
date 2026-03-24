import { execFileSync } from 'node:child_process';
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

  run(_context: ToolContext, args: Record<string, unknown>): ToolResult {
    const url = args.url as string;
    // Use execFileSync (no shell) with the URL embedded via JSON.stringify so
    // special characters in the URL cannot break out of the script string.
    try {
      const script = `
        fetch(${JSON.stringify(url)}, {headers: {'User-Agent': 'auth0-eval-agent/1.0'}, signal: AbortSignal.timeout(15000)})
          .then(r => r.text())
          .then(t => process.stdout.write(t.slice(0, 8000)))
          .catch(e => process.stdout.write('Error: ' + e.message));
      `;
      const result = execFileSync('node', ['-e', script], { encoding: 'utf-8', timeout: 20_000 });
      // Strip HTML tags
      const text = (result as string).replace(/<[^>]+>/g, ' ').replace(/\s{3,}/g, '\n');
      return wrapResult(text.slice(0, 3000).trim());
    } catch (e) {
      return wrapResult(`Could not fetch ${url}: ${e}`);
    }
  }
}
