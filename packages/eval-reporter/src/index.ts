/**
 * @a0/eval-reporter — Report generation and analytics for eval results.
 */

// Report rendering
export { renderHtml } from './report.js';
export { resultVariant, loadScores, groupResults, groupByVariant, computeDeltas, MODES } from './report/processors.js';
export { registerFilters, ALL_FILTERS } from './report-filters.js';

// Braintrust integration
export { createBraintrustReporter, experimentName, mapResult } from './reporters/braintrust.js';
export type { BraintrustReporter, BraintrustReporterOptions } from './reporters/braintrust.js';
export { syncDataset, toEvalSummaries } from './reporters/braintrust-dataset.js';
export type { EvalSummary, DatasetSyncOptions } from './reporters/braintrust-dataset.js';

// Re-export types from @a0/eval for convenience
export type {
  JobResult,
  BaselineJobResult,
  AgentJobResult,
  ErrorJobResult,
  GraderSummary,
  DimensionSummary,
  TraceStep,
  TurnMetricEntry,
  AgentType,
  ErrorCategory,
  Logger,
} from '@a0/eval';
export { GraderLevel, logger, setLogger } from '@a0/eval';
