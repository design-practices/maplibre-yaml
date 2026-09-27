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
  finalizeSpriteBaseUrl,
  attachSpriteAssets,
  attachSpriteImages,
  lowerMarkers,
  EmitError,
  type EmitMode,
  type EmitWarning,
  type EmitAsset,
  type EmitImageRef,
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
  images?: EmitImageRef[];
}> {
  let model = toModel(block as never);

  // Fallback lowerings (markers → symbol layer + pin sprites, KTD4) run only
  // under --with-fallbacks: in strict mode the un-lowered construct surfaces
  // as a lossy warning inside projectStyle, which is exactly what makes
  // --strict refuse the document instead of silently substituting.
  let loweringAssets: EmitAsset[] = [];
  let loweringImages: EmitImageRef[] = [];
  let loweringWarnings: EmitWarning[] = [];
  if (mode === 'with-fallbacks') {
    const lowered = lowerMarkers(model);
    model = lowered.model;
    loweringAssets = lowered.assets;
    loweringImages = lowered.images;
    loweringWarnings = lowered.warnings;
  }

  let projected = applyRuntimeGate(projectStyle(model, mode), policy);
  if (loweringAssets.length > 0) {
    projected = attachSpriteAssets(projected, loweringAssets);
  }
  if (loweringImages.length > 0) {
    projected = attachSpriteImages(projected, loweringImages);
  }
  projected = { ...projected, warnings: [...loweringWarnings, ...projected.warnings] };

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
      ...(projected.images ? { images: projected.images } : {}),
    };
  }

  const base = await resolveBasemap(basemap);
  const merged = mergeBasemap(base, projected);
  return {
    style: merged.style,
    warnings: merged.warnings,
    ...(merged.assets ? { assets: merged.assets } : {}),
    ...(merged.images ? { images: merged.images } : {}),
  };
}

/**
 * The asset-bearing argument contract, as a pure function (unit-testable
 * without driving the whole command): assets require both `--out` (files
 * land beside the style) and `--sprite-base` (MapLibre rejects relative
 * sprite URLs). Returns the error message, or null when the args suffice.
 */
export function spriteAssetArgsError(
  assets: EmitAsset[] | undefined,
  out: string | undefined,
  spriteBase: string | undefined,
  images?: EmitImageRef[],
): string | null {
  const count = (assets?.length ?? 0) + (images?.length ?? 0);
  if (count === 0) return null;
  if (!out) {
    return (
      `This document generates ${count} sprite asset(s); the emitted style ` +
      'is not self-contained without them. Pass --out <dir/style.json> (and ' +
      '--sprite-base) so the sprite files are written beside the style.'
    );
  }
  if (!spriteBase) {
    return (
      'Sprite assets need an absolute URL in the emitted style (MapLibre rejects ' +
      'relative sprite URLs). Pass --sprite-base <url-prefix> pointing at where ' +
      "the style's directory will be served, e.g. --sprite-base https://maps.example.com/app"
    );
  }
  return null;
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
    'sprite-base': {
      type: 'string',
      description:
        'Absolute URL prefix where the sprite files will be served (required ' +
        'when the document generates sprite assets — MapLibre rejects relative ' +
        'sprite URLs, so the emitted style must carry the deployed location)',
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
    let images: EmitImageRef[] | undefined;
    try {
      ({ style, warnings, assets, images } = await emitStyle(parsed.data, mode, policy));
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

    // A document that generates sprite assets is only self-contained as a
    // DIRECTORY (style + sprite files), and MapLibre rejects relative sprite
    // URLs — so both --out and --sprite-base are hard requirements here.
    // Emitting a style whose sprite can never resolve would violate the
    // eject guarantee while looking like success.
    const assetArgsError = spriteAssetArgsError(
      assets,
      args.out as string | undefined,
      args['sprite-base'] as string | undefined,
      images,
    );
    if (assetArgsError) {
      logger.error(assetArgsError);
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
    if ((assets && assets.length > 0) || (images && images.length > 0)) {
      style = finalizeSpriteBaseUrl(style, args['sprite-base'] as string);
    }

    const json = JSON.stringify(style, null, 2);

    if (args.out) {
      const outPath = resolve(args.out as string);

      // Fetch + rasterize BEFORE any write: a fetch or sharp failure must
      // not leave a valid-looking style referencing sprite files that don't
      // exist. Image fetching is the pipeline's second networked step,
      // beside resolveBasemap, with the same failure-is-an-error posture.
      let spriteFiles: { filename: string; data: Buffer }[] = [];
      if ((assets && assets.length > 0) || (images && images.length > 0)) {
        try {
          const { rasterizeSpriteFiles, resolveImageRefs } = await import(
            '../lib/rasterize.js'
          );
          const resolved = images && images.length > 0 ? await resolveImageRefs(images) : [];
          spriteFiles = await rasterizeSpriteFiles(assets ?? [], resolved);
        } catch (err) {
          logger.error('Failed to fetch or rasterize sprite assets; nothing written', err as Error);
          process.exit(EXIT_CODES.UNKNOWN_ERROR);
        }
      }

      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, json + '\n', 'utf-8');
        for (const file of spriteFiles) {
          writeFileSync(resolve(dirname(outPath), file.filename), file.data);
        }
      } catch (err) {
        logger.error(`Failed to write output to ${outPath}`, err as Error);
        process.exit(EXIT_CODES.UNKNOWN_ERROR);
      }
      consola.success(
        spriteFiles.length > 0
          ? `Wrote style + ${spriteFiles.length} sprite file(s) to ${dirname(outPath)}`
          : `Wrote style to ${outPath}`,
      );
      return;
    }

    console.log(json);
  },
});
