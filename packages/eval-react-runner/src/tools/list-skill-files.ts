import { getSkillsManager, collectFiles } from '@a0/eval';
import { docResult } from './base.js';
import type { Tool, ToolContext, ToolName, ToolResult } from './base.js';

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
      skillDir = getSkillsManager().resolveSkillDir(skill);
    } catch {
      return docResult('Access denied: skill path is outside skills directory');
    }
    if (!skillDir) {
      return docResult(`Skill '${skill}' not found`);
    }
    const files = collectFiles(skillDir, skillDir);
    if (files.length === 0) {
      return docResult(`Skill '${skill}' directory is empty`);
    }
    return docResult(files.join('\n'));
  }
}
