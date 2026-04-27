/**
 * Tests for src/cli/config.ts — parseRunConfig() validation branches.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseRunConfig } from '../src/cli/config.js';
import {
  ALL_MODES,
  DEFAULT_MODEL,
  DEFAULT_AGENT_TYPE,
  KNOWN_AGENT_TYPES,
  KNOWN_WORKING_MODELS,
} from '../src/cli/constants.js';
import { EVALUATIONS } from '../src/config/evaluations.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wraps args in the node+script prefix that Commander strips on parse(). */
function argv(...args: string[]): string[] {
  return ['node', 'run.js', ...args];
}

/** Known-valid eval IDs drawn from the live registry so they can't drift. */
const VALID_EVAL_ID = EVALUATIONS[0].id;
const VALID_EVAL_ID_2 = EVALUATIONS[1].id;

// ── Setup ─────────────────────────────────────────────────────────────────────

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.ATKO_API_KEY;
  process.env.ATKO_API_KEY = 'test-key';

  // Prevent process.exit from terminating the test runner.
  // Throwing satisfies the `never` return type and stops execution in the caller.
  vi.spyOn(process, 'exit').mockImplementation((): never => {
    throw new Error('process.exit(1)');
  });

  // Suppress CLI output so test results stay readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  if (savedKey !== undefined) {
    process.env.ATKO_API_KEY = savedKey;
  } else {
    delete process.env.ATKO_API_KEY;
  }
  vi.restoreAllMocks();
});

// ── API key ───────────────────────────────────────────────────────────────────

describe('API key', () => {
  it('exits when ATKO_API_KEY is not set', () => {
    delete process.env.ATKO_API_KEY;
    expect(() => parseRunConfig(argv())).toThrow('process.exit(1)');
  });

  it('includes apiKey from ATKO_API_KEY in the returned config', () => {
    process.env.ATKO_API_KEY = 'my-secret-key';
    const config = parseRunConfig(argv());
    expect(config.apiKey).toBe('my-secret-key');
  });
});

// ── Defaults ──────────────────────────────────────────────────────────────────

describe('defaults', () => {
  it('uses DEFAULT_MODEL when --model is not specified', () => {
    const config = parseRunConfig(argv());
    expect(config.models).toEqual([DEFAULT_MODEL]);
  });

  it('uses baseline mode when --mode is not specified', () => {
    const config = parseRunConfig(argv());
    expect(config.modes).toEqual(['baseline']);
  });

  it('sets workers to 4', () => {
    const config = parseRunConfig(argv());
    expect(config.workers).toBe(4);
  });

  it('sets tools to an empty array', () => {
    const config = parseRunConfig(argv());
    expect(config.tools).toEqual([]);
  });

  it('sets evalIds to an empty array', () => {
    const config = parseRunConfig(argv());
    expect(config.evalIds).toEqual([]);
  });

  it('sets outputPath to undefined', () => {
    const config = parseRunConfig(argv());
    expect(config.outputPath).toBeUndefined();
  });

  it('sets keepWorkspace to false', () => {
    const config = parseRunConfig(argv());
    expect(config.keepWorkspace).toBe(false);
  });

  it('sets braintrust to false', () => {
    const config = parseRunConfig(argv());
    expect(config.braintrust).toBe(false);
  });

  it('sets agentType to undefined when --agent-type is not specified', () => {
    const config = parseRunConfig(argv());
    expect(config.agentType).toBeUndefined();
  });

  it('sets matrix to false by default', () => {
    const config = parseRunConfig(argv());
    expect(config.matrix).toBe(false);
  });

  it('does not include modeArg in the returned config', () => {
    const config = parseRunConfig(argv());
    expect(config).not.toHaveProperty('modeArg');
  });
});

// ── Model selection ───────────────────────────────────────────────────────────

describe('--model', () => {
  it('uses the specified model', () => {
    const config = parseRunConfig(argv('--model', 'claude-sonnet-4-6'));
    expect(config.models).toEqual(['claude-sonnet-4-6']);
  });

  it('accumulates multiple --model flags', () => {
    const config = parseRunConfig(argv('--model', 'gpt-5.2', '--model', 'claude-sonnet-4-6'));
    expect(config.models).toEqual(['gpt-5.2', 'claude-sonnet-4-6']);
  });

  it('--model all expands to every known working model', () => {
    const config = parseRunConfig(argv('--model', 'all'));
    expect(config.models).toEqual(KNOWN_WORKING_MODELS);
  });

  it('--model all takes precedence when mixed with explicit models', () => {
    const config = parseRunConfig(argv('--model', 'gpt-5.2', '--model', 'all'));
    expect(config.models).toEqual(KNOWN_WORKING_MODELS);
  });
});

// ── Mode selection ────────────────────────────────────────────────────────────

describe('--mode', () => {
  it('returns [baseline] for --mode baseline', () => {
    expect(parseRunConfig(argv('--mode', 'baseline')).modes).toEqual(['baseline']);
  });

  it('returns [agent] for --mode agent', () => {
    expect(parseRunConfig(argv('--mode', 'agent')).modes).toEqual(['agent']);
  });

  it('--mode all expands to all known modes', () => {
    expect(parseRunConfig(argv('--mode', 'all')).modes).toEqual(ALL_MODES);
  });

  it('--mode matrix exits with migration hint', () => {
    expect(() => parseRunConfig(argv('--mode', 'matrix'))).toThrow('process.exit(1)');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--matrix'));
  });

  it('non-matrix modes set matrix to false', () => {
    expect(parseRunConfig(argv('--mode', 'baseline')).matrix).toBe(false);
    expect(parseRunConfig(argv('--mode', 'agent')).matrix).toBe(false);
    expect(parseRunConfig(argv('--mode', 'all')).matrix).toBe(false);
  });

  it('exits for an unrecognised mode', () => {
    expect(() => parseRunConfig(argv('--mode', 'unknown'))).toThrow('process.exit(1)');
  });

  it('prints a generic error message for an unrecognised mode', () => {
    expect(() => parseRunConfig(argv('--mode', 'unknown'))).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid mode'));
  });

  it('exits for the legacy agent+skills mode', () => {
    expect(() => parseRunConfig(argv('--mode', 'agent+skills'))).toThrow('process.exit(1)');
  });

  it('prints a migration hint for agent+skills', () => {
    expect(() => parseRunConfig(argv('--mode', 'agent+skills'))).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--mode agent --tools skills'));
  });
});

// ── Matrix flag ──────────────────────────────────────────────────────────────

describe('--matrix', () => {
  it('sets matrix to true', () => {
    expect(parseRunConfig(argv('--matrix')).matrix).toBe(true);
  });

  it('defaults modes to all known modes', () => {
    expect(parseRunConfig(argv('--matrix')).modes).toEqual(ALL_MODES);
  });

  it('defaults models to all known working models', () => {
    expect(parseRunConfig(argv('--matrix')).models).toEqual(KNOWN_WORKING_MODELS);
  });

  it('defaults workers to 20', () => {
    expect(parseRunConfig(argv('--matrix')).workers).toBe(20);
  });

  it('explicit --mode narrows the matrix', () => {
    expect(parseRunConfig(argv('--matrix', '--mode', 'agent')).modes).toEqual(['agent']);
  });

  it('explicit --model narrows the matrix', () => {
    expect(parseRunConfig(argv('--matrix', '--model', 'gpt-5.4')).models).toEqual(['gpt-5.4']);
  });

  it('explicit --workers overrides the matrix default', () => {
    expect(parseRunConfig(argv('--matrix', '--workers', '2')).workers).toBe(2);
  });

  it('explicit --eval narrows the matrix', () => {
    const config = parseRunConfig(argv('--matrix', '--eval', VALID_EVAL_ID));
    expect(config.evalIds).toEqual([VALID_EVAL_ID]);
  });
});

// ── Eval filtering ────────────────────────────────────────────────────────────

describe('--eval', () => {
  it('returns the specified eval ID', () => {
    const config = parseRunConfig(argv('--eval', VALID_EVAL_ID));
    expect(config.evalIds).toEqual([VALID_EVAL_ID]);
  });

  it('accumulates multiple --eval flags', () => {
    const config = parseRunConfig(argv('--eval', VALID_EVAL_ID, '--eval', VALID_EVAL_ID_2));
    expect(config.evalIds).toEqual([VALID_EVAL_ID, VALID_EVAL_ID_2]);
  });

  it('exits for an unknown eval ID', () => {
    expect(() => parseRunConfig(argv('--eval', 'does_not_exist'))).toThrow('process.exit(1)');
  });

  it('prints the unknown eval ID in the error message', () => {
    expect(() => parseRunConfig(argv('--eval', 'does_not_exist'))).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('does_not_exist'));
  });
});

// ── Tool validation ───────────────────────────────────────────────────────────

describe('--tools', () => {
  it('returns an empty array when --tools is not specified', () => {
    expect(parseRunConfig(argv()).tools).toEqual([]);
  });

  it('accepts known tool skills', () => {
    expect(parseRunConfig(argv('--tools', 'skills')).tools).toEqual(['skills']);
  });

  it('accepts known tool mcp', () => {
    expect(parseRunConfig(argv('--tools', 'mcp')).tools).toEqual(['mcp']);
  });

  it('accepts tools in brace syntax', () => {
    expect(parseRunConfig(argv('--tools', '{skills}')).tools).toEqual(['skills']);
  });

  it('accepts comma-separated tools', () => {
    expect(parseRunConfig(argv('--tools', 'skills,mcp')).tools).toEqual(['mcp', 'skills']);
  });

  it('exits for an unknown tool', () => {
    expect(() => parseRunConfig(argv('--tools', 'telepathy'))).toThrow('process.exit(1)');
  });

  it('prints the unknown tool name in the error message', () => {
    expect(() => parseRunConfig(argv('--tools', 'telepathy'))).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('telepathy'));
  });
});

// ── Workers validation ────────────────────────────────────────────────────────

describe('--workers', () => {
  it('parses a valid positive integer', () => {
    expect(parseRunConfig(argv('--workers', '8')).workers).toBe(8);
  });

  it('accepts 1 as the minimum valid value', () => {
    expect(parseRunConfig(argv('--workers', '1')).workers).toBe(1);
  });

  it('exits for 0', () => {
    expect(() => parseRunConfig(argv('--workers', '0'))).toThrow('process.exit(1)');
  });

  it('exits for a negative number', () => {
    expect(() => parseRunConfig(argv('--workers', '-2'))).toThrow('process.exit(1)');
  });

  it('exits for a non-numeric string', () => {
    expect(() => parseRunConfig(argv('--workers', 'many'))).toThrow('process.exit(1)');
  });

  it('prints the invalid value in the error message', () => {
    expect(() => parseRunConfig(argv('--workers', 'many'))).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('many'));
  });
});

// ── Boolean and string flags ──────────────────────────────────────────────────

describe('flags', () => {
  it('--keep-workspace sets keepWorkspace to true', () => {
    expect(parseRunConfig(argv('--keep-workspace')).keepWorkspace).toBe(true);
  });

  it('--braintrust sets braintrust to true', () => {
    expect(parseRunConfig(argv('--braintrust')).braintrust).toBe(true);
  });

  it('--output sets outputPath', () => {
    expect(parseRunConfig(argv('--output', 'results.json')).outputPath).toBe('results.json');
  });
});

// ── Agent type ────────────────────────────────────────────────────────────────

describe('--agent-type', () => {
  it('accepts every known agent type', () => {
    for (const type of KNOWN_AGENT_TYPES) {
      expect(parseRunConfig(argv('--agent-type', type)).agentType).toBe(type);
    }
  });

  it('accepts the default agent type explicitly', () => {
    expect(parseRunConfig(argv('--agent-type', DEFAULT_AGENT_TYPE)).agentType).toBe(DEFAULT_AGENT_TYPE);
  });

  it('exits for an unknown agent type', () => {
    expect(() => parseRunConfig(argv('--agent-type', 'my-custom-agent'))).toThrow('process.exit(1)');
  });

  it('prints the invalid agent type in the error message', () => {
    expect(() => parseRunConfig(argv('--agent-type', 'my-custom-agent'))).toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('my-custom-agent'));
  });
});
