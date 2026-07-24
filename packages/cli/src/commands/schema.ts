/**
 * @file Schema command implementation
 *
 * Prints the JSON Schema for a maplibre-yaml block, resolved from the
 * installed `@maplibre-yaml/core` package. Because it reads the schema that
 * ships with the same core version `mlym validate` uses, the printed contract
 * is always in lock-step with validation. This is the offline / agent path:
 * pipe it to a file, or point `yaml-language-server` at the hosted copy.
 */

import { defineCommand } from 'citty';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import consola from 'consola';
import { logger } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';

const require = createRequire(import.meta.url);

/** The block schemas emitted by @maplibre-yaml/core. */
export const SCHEMA_BLOCKS = ['map', 'scrollytelling', 'root', 'any'] as const;
export type SchemaBlock = (typeof SCHEMA_BLOCKS)[number];

/**
 * Resolve a block's JSON Schema from the installed core package.
 *
 * Reads `@maplibre-yaml/core/schemas/json/<block>.schema.json`, which is
 * generate-on-build and shipped in the core npm package. Guarantees the
 * printed schema matches the core version that `mlym validate` runs.
 *
 * @throws if the block is unknown or the schema artifact cannot be resolved
 * (e.g. core has not been built in a workspace checkout).
 */
export function loadCoreSchema(block: string): unknown {
  if (!SCHEMA_BLOCKS.includes(block as SchemaBlock)) {
    throw new Error(
      `Unknown schema "${block}". Expected one of: ${SCHEMA_BLOCKS.join(', ')}.`,
    );
  }
  let schemaPath: string;
  try {
    schemaPath = require.resolve(
      `@maplibre-yaml/core/schemas/json/${block}.schema.json`,
    );
  } catch {
    throw new Error(
      `Could not resolve the "${block}" schema from @maplibre-yaml/core. ` +
        `In a workspace checkout, build core first: ` +
        `\`pnpm --filter @maplibre-yaml/core build\`.`,
    );
  }
  return JSON.parse(readFileSync(schemaPath, 'utf-8'));
}

export const schemaCommand = defineCommand({
  meta: {
    name: 'schema',
    description:
      'Print the JSON Schema for a block (map, scrollytelling, root, any)',
  },
  args: {
    block: {
      type: 'positional',
      required: false,
      description: `Block schema to print: ${SCHEMA_BLOCKS.join(' | ')} (default: map)`,
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Write the schema to a file instead of stdout',
    },
  },
  async run({ args }) {
    const block = (args.block ?? 'map') as string;

    let schema: unknown;
    try {
      schema = loadCoreSchema(block);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    const json = JSON.stringify(schema, null, 2);

    if (args.out) {
      const outPath = resolve(args.out);
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, json + '\n', 'utf-8');
      } catch (err) {
        logger.error(`Failed to write schema to ${outPath}`, err as Error);
        process.exit(EXIT_CODES.UNKNOWN_ERROR);
      }
      consola.success(`Wrote ${block} schema to ${outPath}`);
      return;
    }

    console.log(json);
  },
});
