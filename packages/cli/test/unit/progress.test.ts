import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgress } from '../../src/lib/progress.js';

describe('progress', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('createProgress', () => {
    it('creates progress indicator with default label', () => {
      const progress = createProgress({ total: 10 });
      expect(progress).toHaveProperty('update');
      expect(progress).toHaveProperty('done');
    });

    it('accepts custom label', () => {
      const progress = createProgress({ total: 10, label: 'Loading' });
      progress.update();
      expect(stdoutWriteSpy).toHaveBeenCalled();
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain('Loading');
    });

    it('updates progress and shows percentage', () => {
      const progress = createProgress({ total: 10 });
      progress.update();
      expect(stdoutWriteSpy).toHaveBeenCalled();
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/\d+%/);
      expect(output).toContain('(1/10)');
    });

    it('shows progress bar', () => {
      const progress = createProgress({ total: 10 });
      progress.update();
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain('█');
      expect(output).toContain('░');
    });

    it('increments by custom amount', () => {
      const progress = createProgress({ total: 10 });
      progress.update(3);
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain('(3/10)');
      expect(output).toContain('30%');
    });

    it('calculates percentage correctly at 50%', () => {
      const progress = createProgress({ total: 100 });
      progress.update(50);
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain('50%');
    });

    it('calculates percentage correctly at 100%', () => {
      const progress = createProgress({ total: 10 });
      for (let i = 0; i < 10; i++) {
        progress.update();
      }
      const lastOutput = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0] as string;
      expect(lastOutput).toContain('100%');
      expect(lastOutput).toContain('(10/10)');
    });

    it('clears progress line when done', () => {
      const progress = createProgress({ total: 10 });
      progress.update();
      progress.done();

      // Should have written spaces to clear the line
      const calls = stdoutWriteSpy.mock.calls;
      const clearCalls = calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes(' '.repeat(10))
      );
      expect(clearCalls.length).toBeGreaterThan(0);
    });

    it('shows completion message when done', () => {
      const progress = createProgress({ total: 10 });
      progress.done('All files processed');

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls.find(call =>
        call.some(arg => typeof arg === 'string' && arg.includes('All files processed'))
      );
      expect(logCall).toBeDefined();
    });

    it('does not show message when done without message', () => {
      const progress = createProgress({ total: 10 });
      progress.done();

      // Should still write to clear the line, but not log a message
      expect(stdoutWriteSpy).toHaveBeenCalled();
    });

    it('handles small totals', () => {
      const progress = createProgress({ total: 1 });
      progress.update();
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain('100%');
    });

    it('handles large totals', () => {
      const progress = createProgress({ total: 1000 });
      progress.update();
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain('(1/1000)');
      expect(output).toContain('0%');
    });

    it('progress bar fills as progress increases', () => {
      const progress = createProgress({ total: 20 });

      progress.update(5); // 25%
      const output1 = stdoutWriteSpy.mock.calls[0][0] as string;
      const filled1 = (output1.match(/█/g) || []).length;

      progress.update(5); // 50%
      const output2 = stdoutWriteSpy.mock.calls[1][0] as string;
      const filled2 = (output2.match(/█/g) || []).length;

      expect(filled2).toBeGreaterThan(filled1);
    });
  });
});
