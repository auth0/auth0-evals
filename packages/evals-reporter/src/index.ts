/**
 * @a0/evals-reporter — Report generation and analytics for eval results.
 */

// Report rendering
export { renderHtml } from './report.js';
export { resultVariant, loadScores, groupResults, groupByVariant, computeDeltas, MODES } from './report/processors.js';
export { registerFilters, ALL_FILTERS } from './report-filters.js';

// Re-export types from @a0/evals-core for convenience
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
} from '@a0/evals-core';
export { logger, setLogger } from '@a0/evals-core';
export { GraderLevel } from '@a0/evals-graders';
