/**
 * Braintrust dataset sync.
 *
 * Pushes evaluation definitions to a Braintrust dataset so experiments
 * link back to the exact inputs that produced their scores.
 */

import { initDataset } from 'braintrust';
import { logger } from '@a0/eval-core';

export interface DatasetSyncOptions {
  projectId?: string;
  datasetName?: string;
}

interface EvalSummary {
  id: string;
  category: string;
  prompt: string;
  scaffoldFiles: string[];
  graderCount: number;
  skills: string[];
}

/**
 * Sync evaluation definitions to a Braintrust dataset.
 * Creates the dataset if it doesn't exist. Inserts one record per evaluation.
 * Returns true on success, null on failure.
 */
export async function syncDataset(summaries: EvalSummary[], opts?: DatasetSyncOptions): Promise<boolean | null> {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) return null;

  const projectId = opts?.projectId ?? process.env.BRAINTRUST_PROJECT_ID;
  if (!projectId) {
    logger.error('[Braintrust] No projectId provided and BRAINTRUST_PROJECT_ID not set.');
    return null;
  }
  const datasetName = opts?.datasetName ?? process.env.BRAINTRUST_DATASET_NAME;
  if (!datasetName) {
    logger.error('[Braintrust] No datasetName provided and BRAINTRUST_DATASET_NAME not set.');
    return null;
  }

  try {
    const dataset = initDataset(projectId, { dataset: datasetName, apiKey });

    for (const ev of summaries) {
      dataset.insert({
        id: ev.id,
        input: {
          eval_id: ev.id,
          prompt: ev.prompt,
          category: ev.category,
          scaffold_files: ev.scaffoldFiles,
        },
        metadata: {
          grader_count: ev.graderCount,
          skills: ev.skills,
        },
      });
    }

    await dataset.flush();
    await dataset.close();
    logger.info(`[Braintrust] Dataset synced: ${summaries.length} evaluation(s) to ${datasetName}`);
    return true;
  } catch (e) {
    logger.error(`[Braintrust] Dataset sync failed: ${e}`);
    return null;
  }
}

/**
 * Build EvalSummary objects from loaded evaluation definitions.
 */
export function toEvalSummaries(
  defs: {
    id: string;
    category: string;
    userPrompt: string;
    scaffold: Record<string, string>;
    graders: unknown[];
    skills: string[];
  }[],
): EvalSummary[] {
  return defs.map((e) => ({
    id: e.id,
    category: e.category,
    prompt: e.userPrompt,
    scaffoldFiles: Object.keys(e.scaffold).sort(),
    graderCount: e.graders.length,
    skills: e.skills,
  }));
}

export type { EvalSummary };
