/**
 * @file The `mlym convert` command — rewrite a document in YAML, JSON or TOML
 *
 * @description
 * `mlym convert map.yaml --to toml` writes the document the author wrote in
 * another format: expressions stay inline, and nothing is filled in or
 * expanded beyond what the target needs. The conversion itself is core's
 * `convertDocument`, the same one the playground's language toggle uses.
 *
 * The contract (KTD10):
 *
 * - The output goes to stdout, or to `--out`. What the target cannot keep
 *   (comments, anchors and merge keys written out, nulls left out of TOML)
 *   is reported on stderr, and the command still exits 0; `--strict` makes
 *   any loss exit 1 and write nothing.
 * - Input that fails validation exits 1 and writes nothing; warnings do not
 *   block. So does a value the target cannot hold (a null in a TOML
 *   expression, `inf` in JSON), naming its path.
 * - `--out` naming the input file is refused, so a typo cannot overwrite it.
 *   Converting to the input's own format is allowed: it reprints the file.
 * - A missing file exits 2. A TOML reader (or converter) file that cannot
 *   be loaded exits 4 (UNKNOWN_ERROR): the environment, not the input.
 * - `-f json` prints one JSON object on stdout whatever the outcome
 *   (`success`, `from`, `to`, `text` or `out`, `losses`, `errors`), with the
 *   same exit codes and nothing on stderr.
 */

import { defineCommand } from 'citty';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import consola from 'consola';
import { convertDocument, type ConvertLoss, type DocumentFormat } from '@maplibre-yaml/core';
import {
  formatConvertJSON,
  lineColumnSuffix,
  tomlReaderFailureMessage,
  type ConvertReport,
  type ConvertReportError,
} from '../lib/formatter.js';
import { logger } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';

const TARGETS: readonly DocumentFormat[] = ['yaml', 'json', 'toml'];

/** `--format` values; `human` is accepted as `text`, as `validate` spells it. */
const OUTPUT_FORMATS = ['text', 'json', 'human'] as const;

/** The real path of `path`, or its resolved path when it does not exist yet. */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export const convertCommand = defineCommand({
  meta: {
    name: 'convert',
    description: 'Rewrite a map or story document in YAML, JSON or TOML',
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Path to a map or story document (.yaml, .yml, .json or .toml)',
    },
    to: {
      type: 'string',
      required: true,
      description: 'The format to write: yaml, json or toml',
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Write to this file instead of stdout (never the input file)',
    },
    strict: {
      type: 'boolean',
      description: 'Fail, writing nothing, if anything would be lost (comments, anchors, nulls)',
    },
    format: {
      type: 'string',
      alias: 'f',
      default: 'text',
      description: 'Output format: text, or json (one object on stdout with the losses and errors)',
    },
  },
  async run({ args }) {
    const outputFormat = String(args.format ?? 'text').toLowerCase();
    if (!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) {
      logger.error(`--format must be text or json, not "${String(args.format)}".`);
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
    const json = outputFormat === 'json';

    const filePath = resolve(args.file as string);
    const to = String(args.to ?? '').toLowerCase() as DocumentFormat;
    let from: DocumentFormat | null = null;

    /**
     * Stop with `exitCode`: in text mode, `lines` on stderr; in json mode,
     * the report on stdout (its errors default to `lines`, as messages).
     */
    const fail = (
      exitCode: number,
      lines: string[],
      report: { errors?: ConvertReportError[]; losses?: ConvertLoss[] } = {}
    ): never => {
      if (json) {
        printReport({
          success: false,
          from,
          to,
          losses: report.losses ?? [],
          errors: report.errors ?? lines.map((message) => ({ path: '', message })),
        });
      } else {
        for (const line of lines) logger.error(line);
      }
      return process.exit(exitCode);
    };

    if (!TARGETS.includes(to)) {
      fail(EXIT_CODES.VALIDATION_ERROR, [`--to must be yaml, json or toml, not "${String(args.to ?? '')}".`]);
    }

    let contents: string;
    try {
      contents = readFileSync(filePath, 'utf-8');
    } catch {
      return fail(EXIT_CODES.FILE_NOT_FOUND, [`Could not read ${filePath}`]);
    }

    const outPath = args.out ? resolve(args.out as string) : undefined;
    if (outPath && realOrResolved(outPath) === realOrResolved(filePath)) {
      fail(EXIT_CODES.VALIDATION_ERROR, [
        `--out names the input file (${filePath}). Write the converted document to another file.`,
      ]);
    }

    const result = await convertDocument(contents, { to, signals: { fileName: filePath } }).catch(
      (err: unknown) =>
        // Only a failed load of the TOML reader or the converter's printers rejects (KTD1).
        fail(EXIT_CODES.UNKNOWN_ERROR, [tomlReaderFailureMessage(err)])
    );
    from = result.from;
    const detail = (errors: ConvertReportError[]) =>
      errors.map((err) => `  ${err.path ? err.path + ': ' : ''}${err.message}${lineColumnSuffix(err)}`);

    // The input must validate before anything is written; warnings do not block.
    if (!result.validation.result.success) {
      const errors = result.validation.result.errors;
      fail(
        EXIT_CODES.VALIDATION_ERROR,
        [`${filePath} is not a valid document; nothing was written.`, ...detail(errors)],
        { errors }
      );
    }
    if (!result.success) {
      fail(
        EXIT_CODES.VALIDATION_ERROR,
        [`${filePath} cannot be written as ${to.toUpperCase()}; nothing was written.`, ...detail(result.errors)],
        { errors: result.errors, losses: result.losses }
      );
      return;
    }

    if (result.losses.length > 0) {
      const summary = `${result.losses.length} thing${result.losses.length === 1 ? '' : 's'} the ${to.toUpperCase()} output does not keep`;
      if (args.strict) {
        const message = `--strict: ${summary}; nothing was written.`;
        if (!json) for (const loss of result.losses) consola.warn(loss.message);
        fail(EXIT_CODES.VALIDATION_ERROR, [message], {
          errors: [{ path: '', message, code: 'strict' }],
          losses: result.losses,
        });
      }
      if (!json) {
        // Losses go to stderr, so `mlym convert map.yaml --to json > map.json` stays clean.
        // Each message names its line or its path.
        for (const loss of result.losses) consola.warn(loss.message);
        consola.warn(`${summary} (listed above).`);
      }
    }

    if (outPath) {
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, result.text, 'utf-8');
      } catch (err) {
        if (json) fail(EXIT_CODES.UNKNOWN_ERROR, [`Failed to write output to ${outPath}: ${(err as Error).message}`]);
        logger.error(`Failed to write output to ${outPath}`, err as Error);
        process.exit(EXIT_CODES.UNKNOWN_ERROR);
      }
      if (json) {
        printReport({ success: true, from, to, out: outPath, losses: result.losses, errors: [] });
        return;
      }
      consola.success(`Wrote ${result.from.toUpperCase()} → ${to.toUpperCase()} to ${outPath}`);
      return;
    }
    if (json) {
      printReport({ success: true, from, to, text: result.text, losses: result.losses, errors: [] });
      return;
    }
    process.stdout.write(result.text);
  },
});

function printReport(report: ConvertReport): void {
  process.stdout.write(formatConvertJSON(report) + '\n');
}
