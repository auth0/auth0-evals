import { readFileSync } from 'node:fs';
import { getSkillsManager, resolveInside } from '@a0/eval-core';
import { toolResult, docResult } from './base.js';
import type { Tool, ToolContext, ToolName, ToolResult } from './base.js';

/**
 * Tool to read a specific documentation file for a given skill.
 */
export class ReadSkillFileTool implements Tool {
  name: ToolName = 'read_skill_file';

  async run(_context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const skill = args.skill as string;
    if (!skill?.trim()) {
      throw new Error(
        'read_skill_file requires a skill name. Use list_skill_files first to discover available skills.',
      );
    }

    const path = args.path as string;
    if (!path?.trim()) {
      throw new Error(
        'read_skill_file requires a path. Use list_skill_files to see which files are available for a skill.',
      );
    }

    let skillDir: string | null;
    try {
      skillDir = getSkillsManager().resolveSkillDir(skill);
    } catch {
      return toolResult('Access denied: skill path is outside skills directory');
    }
    if (!skillDir) {
      return toolResult(`Skill '${skill}' not found`);
    }

    let filePath: string;
    try {
      filePath = resolveInside(skillDir, path);
    } catch {
      return toolResult('Access denied: path is outside skill directory');
    }

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      return toolResult(`File not found: ${path}`);
    }
    return docResult(content);
  }
}
