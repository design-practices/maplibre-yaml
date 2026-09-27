/**
 * @file The `mlym emit` command — compile a document to a standalone style.json
 *
 * @description
 * The eject path, at the command line. A `map` document goes in; a self-contained
 * MapLibre style comes out — one that opens in Maputnik and renders in vanilla
 * `maplibre-gl` on a machine that has never heard of this library.
 *
 * The emitter is imported from the installed `@maplibre-yaml/core`, the same
 * package `mlym validate` parses with, so the two can never disagree about what
 * a document means. That is a plain module import — core is a workspace runtime
 * dependency — not the `require.resolve` of a JSON artifact `mlym schema` uses,
 * which resolves a shipped file rather than code.
 */

import { defineCommand } from 'citty';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import consola from 'consola';
import {
  YAMLParser,
  toModel,
  projectStyle,
  resolveBasemap,
  mergeBasemap,
  applyRuntimeGate,
  EmitError,
  type EmitMode,
  type EmitWarning,
  type EmitAsset,
  type CapabilityPolicy,
  type TrustContext,
} from '@maplibre-yaml/core';
import { logger } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';

/**
 * Compile a parsed map block into a style object.
 *
 * @remarks
 * Kept separate from the command so it is testable without a process exit. The
 * steps are the arc in miniature: normalize to the model, project the style
 * half, gate `state:` on the target runtime, then merge the basemap in — merge
 * last because it is the only step that reaches the network, so everything that
 * can fail cheaply fails first.
 */
export async function emitStyle(
  block: unknown,
  mode: EmitMode,
  policy: CapabilityPolicy,
): Promise<{
  style: Record<string, unknown>;
  warnings: EmitWarning[];
  assets?: EmitAsset[];
}> {
  const model = toModel(block as never);
  const projected = applyRuntimeGate(projectStyle(model, mode), policy);

  // projectStyle enforces --strict over its own warnings, but the runtime
  // gate can ADD lossy ones (state inlined below the target floor). Without
  // this re-check, `mlym emit --strict --target 4.0.0` on a state-using
  // document would degrade lossily and exit 0 — strict must mean strict over
  // the whole pipeline, not the first stage.
  if (mode === 'strict') {
    const lossy = projected.warnings.filter((w) => w.kind === 'lossy');
    if (lossy.length > 0) {
      throw new EmitError(
        `Emit failed in strict mode: ${lossy.length} item(s) could not be represented ` +
          'without changing what the map shows.',
        projected.warnings,
      );
    }
  }

  const basemap = model.style.basemap;
  if (basemap === undefined) {
    return {
      style: projected.style,
      warnings: projected.warnings,
      ...(projected.assets ? { assets: projected.assets } : {}),
    };
  }

  const base = await resolveBasemap(basemap);
  const merged = mergeBasemap(base, projected);
  return {
    style: merged.style,
    warnings: merged.warnings,
    ...(merged.assets ? { assets: merged.assets } : {}),
  };
}

export const emitCommand = defineCommand({
  meta: {
    name: 'emit',
    description:
      'Compile a map document to a standalone, spec-valid style.json',
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Path to a map YAML document',
    },
    strict: {
      type: 'boolean',
      description:
        'Fail if any content cannot be represented without changing the map',
    },
    'with-fallbacks': {
      type: 'boolean',
      description:
        'Degrade unrepresentable content and warn (the default)',
    },
    target: {
      type: 'string',
      description:
        'Target maplibre-gl version, e.g. 5.6.0. Gates state: support',
    },
    trust: {
      type: 'string',
      description: 'Authoring trust context: trusted | untrusted (default)',
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Write the style to a file instead of stdout',
    },
  },
  async run({ args }) {
    const filePath = resolve(args.file as string);

    let contents: string;
    try {
      contents = readFileSync(filePath, 'utf-8');
    } catch {
      logger.error(`Could not read ${filePath}`);
      process.exit(EXIT_CODES.FILE_NOT_FOUND);
    }

    // Only a `map` document compiles: scrollytelling and the pages format sit
    // outside the eject claim by design, so reject them here rather than
    // producing a partial style.
    const parsed = YAMLParser.safeParseMapBlock(contents);
    if (!parsed.success) {
      logger.error(`${filePath} is not a valid map document.`);
      for (const err of parsed.errors) {
        const where = err.line ? ` (${err.line}:${err.column ?? 1})` : '';
        logger.error(`  ${err.path ? err.path + ': ' : ''}${err.message}${where}`);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    if (args.strict && args['with-fallbacks']) {
      logger.error('Choose one of --strict or --with-fallbacks, not both.');
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
    const mode: EmitMode = args.strict ? 'strict' : 'with-fallbacks';

    const trust = (args.trust as string | undefined) ?? 'untrusted';
    if (trust !== 'trusted' && trust !== 'untrusted') {
      logger.error(`--trust must be "trusted" or "untrusted", got "${trust}".`);
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
    const policy: CapabilityPolicy = {
      trust: trust as TrustContext,
      ...(args.target ? { target: args.target as string } : {}),
    };

    let style: Record<string, unknown>;
    let warnings: EmitWarning[];
    let assets: EmitAsset[] | undefined;
    try {
      ({ style, warnings, assets } = await emitStyle(parsed.data, mode, policy));
    } catch (err) {
      if (err instanceof EmitError) {
        logger.error(err.message);
        // Strict-mode failures carry the warnings that tripped them.
        for (const w of err.warnings) {
          logger.error(`  ${w.path}: ${w.message}`);
        }
        process.exit(EXIT_CODES.VALIDATION_ERROR);
      }
      logger.error(`Emit failed: ${(err as Error).message}`);
      process.exit(EXIT_CODES.UNKNOWN_ERROR);
    }

    // Warnings go to stderr so `mlym emit ... > style.json` stays clean.
    for (const w of warnings) {
      consola.warn(`${w.path}: ${w.message}`);
    }

    const json = JSON.stringify(style, null, 2);

    if (args.out) {
      const outPath = resolve(args.out as string);
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, json + '\n', 'utf-8');
      } catch (err) {
        logger.error(`Failed to write style to ${outPath}`, err as Error);
        process.exit(EXIT_CODES.UNKNOWN_ERROR);
      }
      consola.success(`Wrote style to ${outPath}`);

      // Generated sprite assets land beside the style, where the emitted
      // sprite's relative URL (`mlym`) resolves. Rasterization (sharp) is
      // loaded lazily — documents without assets never pay for it.
      if (assets && assets.length > 0) {
        try {
          const { rasterizeSpriteFiles } = await import('../lib/rasterize.js');
          const files = await rasterizeSpriteFiles(assets);
          for (const file of files) {
            writeFileSync(resolve(dirname(outPath), file.filename), file.data);
          }
          consola.success(
            `Wrote ${files.length} sprite file(s) (${assets.length} asset(s)) beside the style`,
          );
        } catch (err) {
          logger.error('Failed to rasterize sprite assets', err as Error);
          process.exit(EXIT_CODES.UNKNOWN_ERROR);
        }
      }
      return;
    }

    if (assets && assets.length > 0) {
      consola.warn(
        `This document generates ${assets.length} sprite asset(s), which need ` +
          'files beside the style — use --out to write them; stdout carries the style only.',
      );
    }
    console.log(json);
  },
});
