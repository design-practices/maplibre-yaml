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
 * - A missing file exits 2.
 */

import { defineCommand } from 'citty';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import consola from 'consola';
import { convertDocument, type DocumentFormat } from '@maplibre-yaml/core';
import { logger } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';

const TARGETS: readonly DocumentFormat[] = ['yaml', 'json', 'toml'];

/** The real path of `path`, or its resolved path when it does not exist yet. */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const where = (item: { line?: number; column?: number }) =>
  item.line ? ` (${item.line}:${item.column ?? 1})` : '';

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
  },
  async run({ args }) {
    const filePath = resolve(args.file as string);
    const to = String(args.to ?? '').toLowerCase() as DocumentFormat;
    if (!TARGETS.includes(to)) {
      logger.error(`--to must be yaml, json or toml, not "${String(args.to ?? '')}".`);
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    let contents: string;
    try {
      contents = readFileSync(filePath, 'utf-8');
    } catch {
      logger.error(`Could not read ${filePath}`);
      process.exit(EXIT_CODES.FILE_NOT_FOUND);
    }

    const outPath = args.out ? resolve(args.out as string) : undefined;
    if (outPath && realOrResolved(outPath) === realOrResolved(filePath)) {
      logger.error(`--out names the input file (${filePath}). Write the converted document to another file.`);
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    const result = await convertDocument(contents, { to, signals: { fileName: filePath } });

    // The input must validate before anything is written; warnings do not block.
    if (!result.validation.result.success) {
      logger.error(`${filePath} is not a valid document; nothing was written.`);
      for (const err of result.validation.result.errors) {
        logger.error(`  ${err.path ? err.path + ': ' : ''}${err.message}${where(err)}`);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
    if (!result.success) {
      logger.error(`${filePath} cannot be written as ${to.toUpperCase()}; nothing was written.`);
      for (const err of result.errors) {
        logger.error(`  ${err.path ? err.path + ': ' : ''}${err.message}${where(err)}`);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    // Losses go to stderr, so `mlym convert map.yaml --to json > map.json` stays clean.
    // Each message names its line or its path.
    for (const loss of result.losses) consola.warn(loss.message);
    if (result.losses.length > 0) {
      const summary = `${result.losses.length} thing${result.losses.length === 1 ? '' : 's'} the ${to.toUpperCase()} output does not keep`;
      if (args.strict) {
        logger.error(`--strict: ${summary}; nothing was written.`);
        process.exit(EXIT_CODES.VALIDATION_ERROR);
      }
      consola.warn(`${summary} (listed above).`);
    }

    if (outPath) {
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, result.text, 'utf-8');
      } catch (err) {
        logger.error(`Failed to write output to ${outPath}`, err as Error);
        process.exit(EXIT_CODES.UNKNOWN_ERROR);
      }
      consola.success(`Wrote ${result.from.toUpperCase()} → ${to.toUpperCase()} to ${outPath}`);
      return;
    }
    process.stdout.write(result.text);
  },
});
