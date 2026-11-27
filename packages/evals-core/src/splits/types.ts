/**
 * Tuning / held-out split types.
 *
 * Evals are split by feature family (`EvalConfig.category`). Tuning evals may be
 * read and fixed against; held-out evals are only used to check that a change
 * carries over to evals nobody tuned on.
 */

/** Which side of the split an eval is on. */
export type EvalSplit = 'tuning' | 'heldout';

/** Which evals a run selects: one side of the split, or both. */
export type SplitSelector = EvalSplit | 'all';

/** One rotation of the split: the families held out from `date` on. */
export interface SplitHistoryEntry {
  /** First day of this period, `YYYY-MM-DD`. */
  date: string;
  /** Families held out in this period. */
  heldout: string[];
  /** Free-text reason or link, e.g. to the approved design. */
  note?: string;
}

/** Contents of the split file (e.g. `eval-splits.json`). */
export interface SplitFile {
  /** Every feature family and its split. A family missing here is an error. */
  families: Record<string, EvalSplit>;
  /** Paired families: one side tuning, the other held out. */
  pairs: [string, string][];
  /** Rotation history, oldest first. The last entry must match the current held-out families. */
  history: SplitHistoryEntry[];
}
