/**
 * Tests for parseRunConfig() validation branches.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseRunConfig,
  extractConfigPath,
  ALL_MODES,
  DEFAULT_MODEL,
  DEFAULT_AGENT_TYPE,
  KNOWN_AGENT_TYPES,
  KNOWN_WORKING_MODELS,
} from '../src/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fake eval IDs for validation tests. */
const KNOWN_EVAL_IDS = ['eval_one', 'eval_two', 'eval_three'];

/** Wraps args in the node+script prefix that Commander strips on parse(). */
function argv(...args: string[]): string[] {
  return ['node', 'run.js', ...args];
}

/** Calls parseRunConfig with the standard options. */
function parse(...args: string[]) {
  return parseRunConfig(argv(...args), { knownEvalIds: KNOWN_EVAL_IDS });
}

const VALID_EVAL_ID = KNOWN_EVAL_IDS[0];
const VALID_EVAL_ID_2 = KNOWN_EVAL_IDS[1];

// ── Setup ─────────────────────────────────────────────────────────────────────

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'test-key';

  // Prevent process.exit from terminating the test runner.
  vi.spyOn(process, 'exit').mockImplementation((): never => {
    throw new Error('process.exit(1)');
  });

  // Suppress CLI output so test results stay readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  if (savedKey !== undefined) {
    process.env.LLM_API_KEY = savedKey;
  } else {
    delete process.env.LLM_API_KEY;
  }
  vi.restoreAllMocks();
});

// ── API key ───────────────────────────────────────────────────────────────────

describe('API key', () => {
  it('exits when LLM_API_KEY is not set', () => {
    delete process.env.LLM_API_KEY;
    expect(() => parse()).toThrow('process.exit(1)');
  });

  it('includes apiKey from LLM_API_KEY in the returned config', () => {
    process.env.LLM_API_KEY = 'my-secret-key';
    const config = parse();
    expect(config.apiKey).toBe('my-secret-key');
  });
});

// ── Defaults ──────────────────────────────────────────────────────────────────

describe('defaults', () => {
  it('uses DEFAULT_MODEL when --model is not specified', () => {
    const config = parse();
    expect(config.models).toEqual([DEFAULT_MODEL]);
  });

  it('uses baseline mode when --mode is not specified', () => {
    const config = parse();
    expect(config.modes).toEqual(['baseline']);
  });

  it('sets workers to 4', () => {
    const config = parse();
    expect(config.workers).toBe(4);
  });

  it('sets runs to 1', () => {
    const config = parse();
    expect(config.runs).toBe(1);
  });

  it('sets tools to an empty array', () => {
    const config = parse();
    expect(config.tools).toEqual([]);
  });

  it('sets evalIds to an empty array', () => {
    const config = parse();
    expect(config.evalIds).toEqual([]);
  });

  it('sets outputPath to undefined', () => {
    const config = parse();
    expect(config.outputPath).toBeUndefined();
  });

  it('sets keepWorkspace to false', () => {
    const config = parse();
    expect(config.keepWorkspace).toBe(false);
  });

  it('sets braintrust to false', () => {
    const config = parse();
    expect(config.braintrust).toBe(false);
  });

  it('sets agentType to undefined when --agent-type is not specified', () => {
    const config = parse();
    expect(config.agentType).toBeUndefined();
  });

  it('does not include modeArg in the returned config', () => {
    const config = parse();
    expect(config).not.toHaveProperty('modeArg');
  });
});

// ── Model selection ───────────────────────────────────────────────────────────

describe('--model', () => {
  it('uses the specified model', () => {
    const config = parse('--model', 'claude-sonnet-4-6');
    expect(config.models).toEqual(['claude-sonnet-4-6']);
  });

  it('accumulates multiple --model flags', () => {
    const config = parse('--model', 'gpt-5.2', '--model', 'claude-sonnet-4-6');
    expect(config.models).toEqual(['gpt-5.2', 'claude-sonnet-4-6']);
  });

  it('--model all expands to every known working model', () => {
    const config = parse('--model', 'all');
    expect(config.models).toEqual(KNOWN_WORKING_MODELS);
  });

  it('--model all takes precedence when mixed with explicit models', () => {
    const config = parse('--model', 'gpt-5.2', '--model', 'all');
    expect(config.models).toEqual(KNOWN_WORKING_MODELS);
  });

  it('--model all expands to the provided knownModels when given', () => {
    const known = ['gpt-5.4', 'claude-opus-4-8'];
    const config = parseRunConfig(argv('--model', 'all'), { knownEvalIds: KNOWN_EVAL_IDS, knownModels: known });
    expect(config.models).toEqual(known);
  });

  it('--model all falls back to KNOWN_WORKING_MODELS when knownModels is empty', () => {
    const config = parseRunConfig(argv('--model', 'all'), { knownEvalIds: KNOWN_EVAL_IDS, knownModels: [] });
    expect(config.models).toEqual(KNOWN_WORKING_MODELS);
  });

  it('explicit --model still passes through even when not in knownModels', () => {
    const config = parseRunConfig(argv('--model', 'claude-opus-4-6'), {
      knownEvalIds: KNOWN_EVAL_IDS,
      knownModels: ['gpt-5.4', 'claude-opus-4-8'],
    });
    expect(config.models).toEqual(['claude-opus-4-6']);
  });
});

// ── Mode selection ────────────────────────────────────────────────────────────

describe('--mode', () => {
  it('returns [baseline] for --mode baseline', () => {
    expect(parse('--mode', 'baseline').modes).toEqual(['baseline']);
  });

  it('returns [agent] for --mode agent', () => {
    expect(parse('--mode', 'agent').modes).toEqual(['agent']);
  });

  it('--mode all expands to all known modes', () => {
    expect(parse('--mode', 'all').modes).toEqual(ALL_MODES);
  });

  it('exits for an unrecognised mode', () => {
    expect(() => parse('--mode', 'unknown')).toThrow('process.exit(1)');
  });

  it('prints a generic error message for an unrecognised mode', () => {
    expect(() => parse('--mode', 'unknown')).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid mode'));
  });

  it('exits for the legacy agent+skills mode', () => {
    expect(() => parse('--mode', 'agent+skills')).toThrow('process.exit(1)');
  });

  it('prints a migration hint for agent+skills', () => {
    expect(() => parse('--mode', 'agent+skills')).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--mode agent --tools skills'));
  });
});

// ── Eval filtering ────────────────────────────────────────────────────────────

describe('--eval', () => {
  it('returns the specified eval ID', () => {
    const config = parse('--eval', VALID_EVAL_ID);
    expect(config.evalIds).toEqual([VALID_EVAL_ID]);
  });

  it('accumulates multiple --eval flags', () => {
    const config = parse('--eval', VALID_EVAL_ID, '--eval', VALID_EVAL_ID_2);
    expect(config.evalIds).toEqual([VALID_EVAL_ID, VALID_EVAL_ID_2]);
  });

  it('exits for an unknown eval ID', () => {
    expect(() => parse('--eval', 'does_not_exist')).toThrow('process.exit(1)');
  });

  it('prints the unknown eval ID in the error message', () => {
    expect(() => parse('--eval', 'does_not_exist')).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('does_not_exist'));
  });
});

// ── Tool validation ───────────────────────────────────────────────────────────

describe('--tools', () => {
  it('returns an empty array when --tools is not specified', () => {
    expect(parse().tools).toEqual([]);
  });

  it('accepts known tool skills', () => {
    expect(parse('--tools', 'skills').tools).toEqual(['skills']);
  });

  it('accepts known tool mcp', () => {
    expect(parse('--tools', 'mcp').tools).toEqual(['mcp']);
  });

  it('accepts tools in brace syntax', () => {
    expect(parse('--tools', '{skills}').tools).toEqual(['skills']);
  });

  it('accepts comma-separated tools', () => {
    expect(parse('--tools', 'skills,mcp').tools).toEqual(['mcp', 'skills']);
  });

  it('exits for an unknown tool', () => {
    expect(() => parse('--tools', 'telepathy')).toThrow('process.exit(1)');
  });

  it('prints the unknown tool name in the error message', () => {
    expect(() => parse('--tools', 'telepathy')).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('telepathy'));
  });
});

// ── Workers validation ────────────────────────────────────────────────────────

describe('--workers', () => {
  it('parses a valid positive integer', () => {
    expect(parse('--workers', '8').workers).toBe(8);
  });

  it('accepts 1 as the minimum valid value', () => {
    expect(parse('--workers', '1').workers).toBe(1);
  });

  it('exits for 0', () => {
    expect(() => parse('--workers', '0')).toThrow('process.exit(1)');
  });

  it('exits for a negative number', () => {
    expect(() => parse('--workers', '-2')).toThrow('process.exit(1)');
  });

  it('exits for a non-numeric string', () => {
    expect(() => parse('--workers', 'many')).toThrow('process.exit(1)');
  });

  it('prints the invalid value in the error message', () => {
    expect(() => parse('--workers', 'many')).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('many'));
  });
});

// ── Boolean and string flags ──────────────────────────────────────────────────

describe('flags', () => {
  it('--keep-workspace sets keepWorkspace to true', () => {
    expect(parse('--keep-workspace').keepWorkspace).toBe(true);
  });

  it('--braintrust sets braintrust to true', () => {
    expect(parse('--braintrust').braintrust).toBe(true);
  });

  it('--output sets outputPath', () => {
    expect(parse('--output', 'results.json').outputPath).toBe('results.json');
  });
});

// ── Agent type ────────────────────────────────────────────────────────────────

describe('--agent-type', () => {
  it('accepts every known agent type', () => {
    for (const type of KNOWN_AGENT_TYPES) {
      expect(parse('--agent-type', type).agentType).toBe(type);
    }
  });

  it('accepts the default agent type explicitly', () => {
    expect(parse('--agent-type', DEFAULT_AGENT_TYPE).agentType).toBe(DEFAULT_AGENT_TYPE);
  });

  it('exits for an unknown agent type', () => {
    expect(() => parse('--agent-type', 'my-custom-agent')).toThrow('process.exit(1)');
  });

  it('prints the invalid agent type in the error message', () => {
    expect(() => parse('--agent-type', 'my-custom-agent')).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('my-custom-agent'));
  });
});

// ── extractConfigPath ─────────────────────────────────────────────────────────

describe('extractConfigPath', () => {
  it('returns undefined when --config is absent', () => {
    expect(extractConfigPath(argv('--model', 'all'))).toBeUndefined();
  });

  it('extracts the value from the space-separated form', () => {
    expect(extractConfigPath(argv('--config', 'my.config.js', '--mode', 'agent'))).toBe('my.config.js');
  });

  it('extracts the value from the --config=<path> form', () => {
    expect(extractConfigPath(argv('--config=/abs/path/eval.config.js'))).toBe('/abs/path/eval.config.js');
  });
});

// ── Runs validation ───────────────────────────────────────────────────────────

describe('--runs', () => {
  it('parses a valid positive integer', () => {
    expect(parse('--runs', '3').runs).toBe(3);
  });

  it('accepts 1 as the minimum valid value', () => {
    expect(parse('--runs', '1').runs).toBe(1);
  });

  it('exits for 0', () => {
    expect(() => parse('--runs', '0')).toThrow('process.exit(1)');
  });

  it('exits for a negative number', () => {
    expect(() => parse('--runs', '-1')).toThrow('process.exit(1)');
  });

  it('exits for a non-numeric string', () => {
    expect(() => parse('--runs', 'many')).toThrow('process.exit(1)');
  });

  it('exits for a float value', () => {
    expect(() => parse('--runs', '2.9')).toThrow('process.exit(1)');
  });

  it('prints the invalid value in the error message', () => {
    expect(() => parse('--runs', 'many')).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('many'));
  });
});
