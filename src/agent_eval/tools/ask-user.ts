import { Tool, ToolContext, ToolName, ToolResult } from './base.js';

function wrapResult(message: string): ToolResult {
  return [message, false, true, false];
}

/**
 * AskUserTool allows the agent to ask the user a question.
 * If the question seems to be asking for credentials that are available in the context, it returns those.
 */
export class AskUserTool implements Tool {
  name: ToolName = 'ask_user';

  run(context: ToolContext, args: Record<string, unknown>): ToolResult {
    const question = args.question as string;
    const lowerQ = question.toLowerCase();
    if ((lowerQ.includes('domain') || lowerQ.includes('tenant')) && 'domain' in context.credentials) {
      return wrapResult(context.credentials.domain);
    }
    if (
      (lowerQ.includes('client id') || lowerQ.includes('clientid') || lowerQ.includes('client_id')) &&
      'client_id' in context.credentials
    ) {
      return wrapResult(context.credentials.client_id);
    }
    console.log(`\n[AGENT ASKING]: ${question}`);
    // In automated mode, return placeholder
    return wrapResult('(no answer provided)');
  }
}
