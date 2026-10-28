/**
 * The one way reading a document rejects: the TOML reader (or the
 * converter's printers), core's on-demand chunk, could not be loaded — a
 * `FormatError` of code `"chunk"` (KTD1). Every command that reads a
 * document reports it in the same words and, where it exits, with
 * `EXIT_CODES.UNKNOWN_ERROR`: it is an environment problem, not bad input.
 *
 * A built core loads its chunks from disk, so the failure is forced by
 * mocking the two entry points that await them.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { runCommand } from 'citty';
import { EXIT_CODES } from '../../src/types.js';

vi.mock('@maplibre-yaml/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@maplibre-yaml/core')>();
  const chunkFailure = () =>
    new core.FormatError({
      code: 'chunk',
      format: 'toml' as never,
      url: 'formats/toml.js',
      detail: 'Cannot find module formats/toml.js',
    });
  return {
    ...core,
    convertDocument: vi.fn(async () => {
      throw chunkFailure();
    }),
    parseDocumentText: vi.fn(async () => {
      throw chunkFailure();
    }),
  };
});

const { convertCommand } = await import('../../src/commands/convert.js');
const { emitCommand } = await import('../../src/commands/emit.js');
const { validateFile } = await import('../../src/lib/validator.js');
const { logger } = await import('../../src/lib/logger.js');

class Exit extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe('a TOML reader chunk that cannot be loaded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mlym-chunk-'));
  const doc = join(dir, 'map.toml');
  writeFileSync(doc, 'type = "map"\nid = "m"\n');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  let errors: string[];
  let stdout: string[];
  beforeEach(() => {
    errors = [];
    stdout = [];
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Exit(code);
    }) as never);
    vi.spyOn(logger, 'error').mockImplementation(((message: unknown) => {
      errors.push(String(message));
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    }) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const exitOf = async (run: Promise<unknown>) => {
    try {
      await run;
    } catch (err) {
      if (err instanceof Exit) return err.code;
      throw err;
    }
    return undefined;
  };

  it('mlym convert says the TOML reader could not be loaded and exits UNKNOWN_ERROR', async () => {
    const code = await exitOf(runCommand(convertCommand, { rawArgs: [doc, '--to', 'yaml'] }));
    expect(code).toBe(EXIT_CODES.UNKNOWN_ERROR);
    expect(errors.join('\n')).toContain('The TOML reader could not be loaded');
    expect(errors.join('\n')).toContain('formats/toml.js');
  });

  it('mlym convert -f json says so in its JSON too, and exits UNKNOWN_ERROR', async () => {
    const code = await exitOf(runCommand(convertCommand, { rawArgs: [doc, '--to', 'yaml', '-f', 'json'] }));
    expect(code).toBe(EXIT_CODES.UNKNOWN_ERROR);
    const out = JSON.parse(stdout.join(''));
    expect(out.success).toBe(false);
    expect(out.errors[0].message).toContain('The TOML reader could not be loaded');
  });

  it('mlym emit says the same and exits UNKNOWN_ERROR', async () => {
    const code = await exitOf(runCommand(emitCommand, { rawArgs: [doc] }));
    expect(code).toBe(EXIT_CODES.UNKNOWN_ERROR);
    expect(errors.join('\n')).toContain('The TOML reader could not be loaded');
  });

  it('mlym validate reports it as the file\'s error', async () => {
    const result = await validateFile(doc);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toContain('The TOML reader could not be loaded');
  });
});
