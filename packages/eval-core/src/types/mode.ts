/** The two concrete execution modes. `"all"` is a CLI meta-value that expands to this union. */
export type Mode = 'baseline' | 'agent';

/** Supported execution modes. `"all"` is a meta-value that expands to this list. */
export const ALL_MODES: Mode[] = ['baseline', 'agent'];
