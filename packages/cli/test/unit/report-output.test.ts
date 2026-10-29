/**
 * `--format json` failures of the report commands (`mlym breaks`, `mlym
 * prepare`) use `mlym convert`'s error envelope — `errors: [{ path, message,
 * code }]`, one entry per problem — so one reader handles every command's
 * JSON failures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reportOutput } from '../../src/lib/report-output.js';
import { prepareCommand } from '../../src/commands/prepare.js';
import { breaksCommand } from '../../src/commands/breaks.js';
import { EXIT_CODES } from '../../src/types.js';

class Exit extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

let stdout: string[];
beforeEach(() => {
  stdout = [];
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Exit(code);
  }) as never);
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    stdout.push(String(chunk));
    return true;
  }) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Run `work`, expecting it to exit; the exit code and the JSON it printed. */
async function exited(work: () => unknown): Promise<{ code: number | undefined; report: any }> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
    return { code: error.code, report: JSON.parse(stdout.join('')) };
  }
  throw new Error('expected process.exit');
}

const missing = join(tmpdir(), 'mlym-report-output-missing.fgb');

describe('reportOutput: --format json failures', () => {
  it("print convert's error shape, one entry per line of the message", async () => {
    const { code, report } = await exited(() =>
      reportOutput('json').fail(EXIT_CODES.VALIDATION_ERROR, '--classes: too many\n--method: not a method')
    );
    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(report).toEqual({
      success: false,
      errors: [
        { path: '', message: '--classes: too many', code: 'validation-error' },
        { path: '', message: '--method: not a method', code: 'validation-error' },
      ],
    });
  });


  it('mlym prepare -f json: a missing file', async () => {
    const { code, report } = await exited(() => prepareCommand.run!({ args: { file: missing, format: 'json' } } as never));
    expect(code).toBe(EXIT_CODES.FILE_NOT_FOUND);
    expect(report).toMatchObject({ success: false });
    expect(report.errors).toEqual([{ path: '', message: expect.stringMatching(/no such file/), code: 'file-not-found' }]);
  });

  it('mlym prepare -f json: no file argument', async () => {
    const { code, report } = await exited(() => prepareCommand.run!({ args: { format: 'json' } } as never));
    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(report.errors).toEqual([{ path: '', message: expect.stringMatching(/mlym prepare <file>/), code: 'validation-error' }]);
  });

  it('mlym breaks -f json: a missing file', async () => {
    const { code, report } = await exited(() =>
      breaksCommand.run!({ args: { file: missing, field: 'population', format: 'json' } } as never)
    );
    expect(code).toBe(EXIT_CODES.FILE_NOT_FOUND);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ path: '', code: 'file-not-found' });
    expect(typeof report.errors[0].message).toBe('string');
  });
});
