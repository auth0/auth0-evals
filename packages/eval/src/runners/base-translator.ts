import { logger } from '@a0/eval-core';
import type { ToolTranslator } from './tool-translator.js';

/**
 * Abstract base for agent tool translators.
 *
 * Subclasses declare their tool mapping tables and override hook
 * methods (normalizeKey, isMcpTool, mapMcpName, normalizeFallback) to handle agent-specific
 * naming conventions. normalizeArgs stays abstract because each agent's
 * argument shapes are unique.
 */
export abstract class BaseToolTranslator implements ToolTranslator {
  /** Maps agent-native tool names to internal taxonomy names. */
  protected abstract readonly toolMap: Record<string, string>;
  /** Tools that count as documentation lookups in scoring. */
  protected abstract readonly docLookupSet: Set<string>;
  /** Tools that count as user interruptions in scoring. */
  protected abstract readonly interruptionSet: Set<string>;
  /** Tools excluded from scoring (internal bookkeeping). */
  protected abstract readonly internalToolSet: Set<string>;
  /** Tag used in unknown-tool warnings. */
  protected abstract readonly logTag: string;

  /** Normalize the raw tool name before map lookups. Default: identity. */
  protected normalizeKey(name: string): string {
    return name;
  }

  /** Whether the normalized name refers to an MCP tool. Default: false. */
  protected isMcpTool(_name: string): boolean {
    return false;
  }

  /** Map an MCP tool name to its internal representation. Default: identity. */
  protected mapMcpName(name: string): string {
    return name;
  }

  /** Normalize an unknown tool name used as the fallback return value. Default: identity. */
  protected normalizeFallback(key: string): string {
    return key;
  }

  mapName(name: string): string {
    const key = this.normalizeKey(name);
    if (this.isMcpTool(key)) return this.mapMcpName(key);
    if (Object.hasOwn(this.toolMap, key)) return this.toolMap[key]!;
    const fallback = this.normalizeFallback(key);
    logger.warn(`[${this.logTag}] Unknown tool "${name}" — falling back to "${fallback}"`);
    return fallback;
  }

  abstract normalizeArgs(name: string, args: Record<string, unknown>): Record<string, unknown>;

  isDocLookup(name: string): boolean {
    const key = this.normalizeKey(name);
    return this.docLookupSet.has(key) || this.isMcpTool(key);
  }

  isInterruption(name: string): boolean {
    return this.interruptionSet.has(this.normalizeKey(name));
  }

  isInternalTool(name: string): boolean {
    return this.internalToolSet.has(this.normalizeKey(name));
  }
}
