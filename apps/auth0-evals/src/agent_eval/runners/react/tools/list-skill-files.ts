import { resolveSkillDir } from '../../../skills/config.js';
import { collectFiles } from '@a0/eval';
import { Tool, ToolContext, ToolName, ToolResult } from './base.js';

function wrapResult(message: string): ToolResult {
  return [message, true, false, false];
}

/**
 * Tool to list available documentation files for a given skill.
 */
export class ListSkillFilesTool implements Tool {
  name: ToolName = 'list_skill_files';

  async run(_context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const skill = args.skill as string;
    if (!skill?.trim()) {
      throw new Error(
        'list_skill_files requires a skill name. Use list_skill_files with a skill name to list its files.',
      );
    }
    let skillDir: string | null;
    try {
      skillDir = resolveSkillDir(skill);
    } catch {
      return wrapResult('Access denied: skill path is outside skills directory');
    }
    if (!skillDir) {
      return wrapResult(`Skill '${skill}' not found`);
    }
    const files = collectFiles(skillDir, skillDir);
    if (files.length === 0) {
      return wrapResult(`Skill '${skill}' directory is empty`);
    }
    return wrapResult(files.join('\n'));
  }
}
