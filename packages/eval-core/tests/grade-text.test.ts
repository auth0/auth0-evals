import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { extractCodeBlocks } from '../src/graders/grade-text.js';

vi.mock('../src/graders/engine.js', () => ({
  runGraders: vi.fn().mockResolvedValue([{ name: 'mock', passed: true }]),
}));

describe('extractCodeBlocks', () => {
  it('extracts fenced code blocks (single, multiple, language-tagged)', () => {
    expect(extractCodeBlocks('Hello\n```\nconst x = 1;\n```\nBye')).toBe('const x = 1;\n');
    expect(extractCodeBlocks('```\nfirst\n```\ntext\n```\nsecond\n```\n')).toBe('first\n\n\nsecond\n');
    expect(extractCodeBlocks('```typescript\nconst y = 2;\n```\n')).toBe('const y = 2;\n');
  });

  it('falls back to text after unclosed fence', () => {
    expect(extractCodeBlocks('Before\n```js\nconst a = 1;')).toBe('const a = 1;');
  });

  it('returns raw text if no fence at all', () => {
    expect(extractCodeBlocks('just plain text')).toBe('just plain text');
  });
});

describe('gradeText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts code, writes to temp dir, calls runGraders, and cleans up', async () => {
    const { gradeText } = await import('../src/graders/grade-text.js');
    const { runGraders } = await import('../src/graders/engine.js');
    const mockedRunGraders = vi.mocked(runGraders);

    const evalDef = { graders: [{ name: 'test', level: undefined }] } as any;
    const text = '```\nconst x = 1;\n```\n';

    const result = await gradeText(evalDef, text, 'fake-key');

    expect(mockedRunGraders).toHaveBeenCalledOnce();
    const [graders, workspace, apiKey, judgeModel, allowedLevels, enforceMaxChars] = mockedRunGraders.mock.calls[0];
    expect(graders).toBe(evalDef.graders);
    expect(workspace).toMatch(/eval_grade_/);
    expect(apiKey).toBe('fake-key');
    expect(judgeModel).toBeUndefined();
    expect(allowedLevels).toBeUndefined();
    expect(enforceMaxChars).toBe(false);
    expect(result).toEqual([{ name: 'mock', passed: true }]);
    expect(existsSync(workspace as string)).toBe(false);
  });

});
