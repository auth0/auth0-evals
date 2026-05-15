import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockLoadScores = vi.hoisted(() => vi.fn());
const mockRenderHtml = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readdirSync: mockReaddirSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('@a0/eval-reporter', () => ({
  loadScores: mockLoadScores,
  renderHtml: mockRenderHtml,
}));

import { runReport } from '../src/cli/report.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(process, 'cwd').mockReturnValue('/project');
});

describe('runReport', () => {
  describe('auto-discovery', () => {
    it('throws when no scores files are found', async () => {
      mockReaddirSync.mockReturnValue(['README.md', 'package.json']);

      await expect(runReport({ output: 'report.html' })).rejects.toThrow('No scores-*.json files found');

      expect(mockLoadScores).not.toHaveBeenCalled();
    });

    it('throws when directory is empty', async () => {
      mockReaddirSync.mockReturnValue([]);

      await expect(runReport({ output: 'report.html' })).rejects.toThrow('No scores-*.json files found');
    });

    it('passes only scores-*.json files to loadScores', async () => {
      mockReaddirSync.mockReturnValue([
        'scores-baseline.json',
        'README.md',
        'scores-agent.json',
        'package.json',
        'scores-consolidated.json',
        'not-scores.json',
      ]);
      mockLoadScores.mockReturnValue([{ eval_id: 'test' }]);
      mockRenderHtml.mockReturnValue('<html></html>');

      await runReport({ output: 'report.html' });

      expect(mockLoadScores).toHaveBeenCalledWith([
        '/project/scores-agent.json',
        '/project/scores-baseline.json',
        '/project/scores-consolidated.json',
      ]);
    });

    it('sorts discovered files alphabetically', async () => {
      mockReaddirSync.mockReturnValue(['scores-z.json', 'scores-a.json', 'scores-m.json']);
      mockLoadScores.mockReturnValue([{ eval_id: 'test' }]);
      mockRenderHtml.mockReturnValue('<html></html>');

      await runReport({ output: 'report.html' });

      expect(mockLoadScores).toHaveBeenCalledWith([
        '/project/scores-a.json',
        '/project/scores-m.json',
        '/project/scores-z.json',
      ]);
    });
  });

  describe('explicit input', () => {
    it('skips auto-discovery when input files are provided', async () => {
      mockLoadScores.mockReturnValue([{ eval_id: 'test' }]);
      mockRenderHtml.mockReturnValue('<html></html>');

      // Clear any calls from module initialization
      mockReaddirSync.mockClear();

      await runReport({ input: ['a.json', 'b.json'], output: 'report.html' });

      expect(mockReaddirSync).not.toHaveBeenCalled();
      expect(mockLoadScores).toHaveBeenCalledWith(['a.json', 'b.json']);
    });
  });

  describe('output', () => {
    it('writes HTML report and consolidated JSON', async () => {
      mockLoadScores.mockReturnValue([{ eval_id: 'test' }]);
      mockRenderHtml.mockReturnValue('<html>report</html>');

      await runReport({ input: ['scores.json'], output: 'my-report.html' });

      expect(mockWriteFileSync).toHaveBeenCalledWith('/project/my-report.html', '<html>report</html>', 'utf-8');
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/project/scores-consolidated.json',
        JSON.stringify([{ eval_id: 'test' }], null, 2),
        'utf-8',
      );
    });
  });
});
