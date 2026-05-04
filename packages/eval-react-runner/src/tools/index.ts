import type { Tool } from './base.js';
import { AskUserTool } from './ask-user.js';
import { FetchUrlTool } from './fetch-url.js';
import { FinishTaskTool } from './finish-task.js';
import { ListFilesTool } from './list-files.js';
import { ListSkillFilesTool } from './list-skill-files.js';
import { ReadFileTool } from './read-file.js';
import { ReadSkillFileTool } from './read-skill-file.js';
import { RunCommandTool } from './run-command.js';
import { WriteFileTool } from './write-file.js';

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to a file within the workspace' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List all files under a directory in the project workspace. ' +
        'Pass an empty string to list the entire workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Relative path to a directory within the workspace, ' + 'or an empty string for the workspace root.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write or overwrite a file in the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command inside the project workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch the contents of a documentation URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Ask the user for information you cannot determine yourself ' +
        '(e.g. credentials, tenant domain, client IDs, dashboard URLs). ' +
        'Only use this when you truly cannot proceed without human input.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_task',
      description:
        'Signal that the task is complete. Call this when all required ' +
        'files have been written and no further changes are needed.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief summary of what was done' },
        },
        required: ['summary'],
      },
    },
  },
];

export const SKILL_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_skill_files',
      description: 'List all files available in an Auth0 SDK skill directory.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'The skill name (e.g. auth0-express, auth0-react)' },
        },
        required: ['skill'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill_file',
      description: 'Read a specific file from an Auth0 SDK skill directory.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'The skill name (e.g. auth0-express, auth0-react)' },
          path: { type: 'string', description: 'Relative path to the file within the skill directory' },
        },
        required: ['skill', 'path'],
      },
    },
  },
];

export function buildToolDefinitions(tools: string[], mcpToolDefs: unknown[] = []): unknown[] {
  const defs: unknown[] = [...TOOL_DEFINITIONS];
  if (tools.includes('mcp')) {
    defs.push(...mcpToolDefs);
  }
  if (tools.includes('skills')) {
    defs.push(...SKILL_TOOL_DEFINITIONS);
  }
  return defs;
}

export const ALL_BASE_TOOLS: Tool[] = [
  new ReadFileTool(),
  new WriteFileTool(),
  new ListFilesTool(),
  new RunCommandTool(),
  new FetchUrlTool(),
  new AskUserTool(),
  new FinishTaskTool(),
  new ListSkillFilesTool(),
  new ReadSkillFileTool(),
];
