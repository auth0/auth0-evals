import type { ToolTranslator } from '@a0/eval-core';

/**
 * No-op translator for agents that already use the internal taxonomy.
 * Used by the ReAct agent — its tool names are the internal names.
 */
export class IdentityTranslator implements ToolTranslator {
  mapName(name: string): string {
    return name;
  }

  normalizeArgs(_toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    return args;
  }

  isDocLookup(_toolName: string): boolean {
    return false;
  }

  isInterruption(_toolName: string): boolean {
    return false;
  }

  isInternalTool(_toolName: string): boolean {
    return false;
  }
}
