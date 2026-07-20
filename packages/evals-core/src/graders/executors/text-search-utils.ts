/**
 * Shared utilities for text-search grader executors.
 */

/** Extensions that identify non-source files (config files and documentation). */
export const NON_SOURCE_EXTS = /\.(?:env|json|plist|xml|yaml|yml|toml|ini|cfg|conf|md)$/i;

/** Filename prefixes that identify non-source (config-only) files. */
export const NON_SOURCE_PREFIXES = /^\.env/;
