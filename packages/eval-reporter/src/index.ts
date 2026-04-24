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

// Types
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
} from './types/results.js';
export { GraderLevel } from './types/results.js';

// Logger
export { logger, setLogger } from './utils/logger.js';
export type { Logger } from './utils/logger.js';
