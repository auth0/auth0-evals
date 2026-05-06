export class EvalFrameworkError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EvalFrameworkError';
  }
}

export class EvalNotFoundError extends EvalFrameworkError {
  constructor(evalId: string) {
    super(`Eval not found: ${evalId}`, 'EVAL_NOT_FOUND', { evalId });
    this.name = 'EvalNotFoundError';
  }
}

export class UnknownModeError extends EvalFrameworkError {
  constructor(mode: string) {
    super(`Unknown execution mode: '${mode}'`, 'UNKNOWN_MODE', { mode });
    this.name = 'UnknownModeError';
  }
}

export class LlmApiError extends EvalFrameworkError {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`LLM API error ${status}: ${body.slice(0, 400)}`, 'LLM_API_ERROR', { status, body: body.slice(0, 400) });
    this.name = 'LlmApiError';
  }
}

export class EvalConfigError extends EvalFrameworkError {
  constructor(message: string, path: string) {
    super(`${message}: ${path}`, 'EVAL_CONFIG_ERROR', { path });
    this.name = 'EvalConfigError';
  }
}

export class JudgeError extends EvalFrameworkError {
  constructor(model: string, reason: string) {
    super(`Judge (${model}) failed: ${reason}`, 'JUDGE_ERROR', { model, reason });
    this.name = 'JudgeError';
  }
}

export class BedrockToolConfigError extends EvalFrameworkError {
  constructor(model: string) {
    super(
      `Bedrock model '${model}' requires special handling. Ensure it is listed in the BEDROCK_MODELS configuration.`,
      'BEDROCK_TOOL_CONFIG_ERROR',
      { model },
    );
    this.name = 'BedrockToolConfigError';
  }
}
