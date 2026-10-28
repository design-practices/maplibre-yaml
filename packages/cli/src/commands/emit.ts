/**
 * @file The `mlym emit` command — compile a document to a standalone style.json
 *
 * @description
 * The export path, at the command line. A `map` document goes in; a self-contained
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
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import consola from 'consola';
import {
  parseDocumentText,
  toModel,
  projectStyle,
  resolveBasemap,
  mergeBasemap,
  applyRuntimeGate,
  finalizeSpriteBaseUrl,
  attachSpriteAssets,
  attachSpriteImages,
  lowerMarkers,
  lowerFitTo,
  attachSourceData,
  bakeClassify,
  EmitError,
  type EmitMode,
  type EmitWarning,
  type EmitAsset,
  type EmitImageRef,
  type CapabilityPolicy,
  type TrustContext,
  type ClassifyDataLoader,
} from '@maplibre-yaml/core';
import { lineColumnSuffix, tomlReaderFailureMessage } from '../lib/formatter.js';
import { logger } from '../lib/logger.js';
import { resolveDataRefs, type DataReader } from '../lib/data-refs.js';
import { createDataLoader } from '../lib/data-loader.js';
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
  options: {
    /**
     * Loads a `classify: { method }` layer's data when its source is fetched
     * (`url:`). Default: http(s) URLs, and local paths from the working
     * folder; `mlym emit` passes one that resolves against the document.
     */
    loadData?: ClassifyDataLoader;
    /**
     * The document's path: FlatGeobuf / GeoParquet files (ml-cnv.3/.4) are looked up the way
     * `loadData` looks up GeoJSON (beside it, then the site root / public/).
     */
    documentPath?: string;
    /** An injectable FlatGeobuf / GeoParquet file reader, for tests. */
    reader?: DataReader;
  } = {},
): Promise<{
  style: Record<string, unknown>;
  warnings: EmitWarning[];
  assets?: EmitAsset[];
  images?: EmitImageRef[];
}> {
  let model = toModel(block as never);

  // classify: breaks a `method:` computes from fetched data are baked now,
  // in both modes. A classed map whose classes are unknown has no honest
  // fallback (one flat colour would look like a result), so data that
  // cannot be loaded fails the export, naming the layer, URL and fix.
  const baked = await bakeClassify(model, options.loadData ?? createDataLoader());
  if (baked.errors.length > 0) {
    throw new EmitError(
      `Export failed: ${baked.errors.length} classify layer(s) could not compute their breaks.\n` +
        baked.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'),
    );
  }
  model = baked.model;

  // Fallback lowerings (markers → symbol layer + pin sprites, fitTo → a
  // computed camera; KTD4) run only
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
    // fitTo → a concrete camera computed from inline source data (U14).
    const fitted = lowerFitTo(model);
    model = fitted.model;
    loweringWarnings = [...loweringWarnings, ...fitted.warnings];
  }

  let projected = applyRuntimeGate(projectStyle(model, mode), policy);
  if (loweringAssets.length > 0) {
    projected = attachSpriteAssets(projected, loweringAssets);
  }
  if (loweringImages.length > 0) {
    projected = attachSpriteImages(projected, loweringImages);
  }
  projected = { ...projected, warnings: [...loweringWarnings, ...projected.warnings] };

  // FlatGeobuf / GeoParquet sources (ml-cnv.3/.4): core emitted each empty and described
  // the file; read and inline the features now. An unreadable file stays
  // empty and is reported lossy, so the strict check below refuses it.
  if (projected.data && projected.data.length > 0) {
    const { resolved, warnings: dataWarnings } = await resolveDataRefs(projected.data, {
      ...(options.documentPath ? { documentPath: options.documentPath } : {}),
      ...(options.reader ? { reader: options.reader } : {}),
    });
    projected = {
      ...projected,
      style: attachSourceData(projected.style, resolved),
      warnings: [...projected.warnings, ...dataWarnings],
    };
  }

  // projectStyle enforces --strict over its own warnings, but the runtime
  // gate can ADD lossy ones (state inlined below the target floor). Without
  // this re-check, `mlym emit --strict --target 4.0.0` on a state-using
  // document would degrade lossily and exit 0 — strict must mean strict over
  // the whole pipeline, not the first stage.
  if (mode === 'strict') {
    const lossy = projected.warnings.filter((w) => w.kind === 'lossy');
    if (lossy.length > 0) {
      throw new EmitError(
        `Export failed in strict mode: ${lossy.length} item(s) could not be exported ` +
          'to style.json without changing what the map shows.',
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
  // The merge can ADD lossy warnings too (a document sprite shadowing a
  // basemap sprite id orphans basemap icons) — strict means strict over the
  // WHOLE pipeline, so re-check after the last warning producer.
  if (mode === 'strict') {
    const lossy = merged.warnings.filter((w) => w.kind === 'lossy');
    if (lossy.length > 0) {
      throw new EmitError(
        `Export failed in strict mode: ${lossy.length} item(s) could not be exported ` +
          'to style.json without changing what the map shows.',
        merged.warnings,
      );
    }
  }
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

/**
 * Where `--out` writes the style. A path naming a folder — one that already
 * exists, or one written with a trailing slash (`--out dist/`) — gets
 * `style.json` inside it; anything else is the style file itself. Before
 * this, `--out dist/` wrote a FILE called `dist`.
 */
export function resolveOutPath(out: string): string {
  const path = resolve(out);
  const namesFolder =
    /[\\/]$/.test(out) || (existsSync(path) && statSync(path).isDirectory());
  return namesFolder ? join(path, 'style.json') : path;
}

/**
 * The deprecation note for `--trust`, or null when it was not given.
 *
 * @remarks
 * `--trust trusted|untrusted` set the capability policy's trust. That policy
 * gates raw `!html` in popups and `click.emit` host events, and both belong to
 * the runtime half that export drops, so no step of `emit` reads it: trusted
 * and untrusted exports were byte-identical (ml-aot.144). The flag is still
 * accepted, so scripts that pass it keep working, but it is out of `--help`
 * and prints this note on stderr. Parsing stops at `--`, as citty's does.
 */
export function trustFlagNote(rawArgs: readonly string[]): string | null {
  const end = rawArgs.indexOf('--');
  const given = (end === -1 ? rawArgs : rawArgs.slice(0, end)).some(
    (arg) => arg === '--trust' || arg.startsWith('--trust='),
  );
  if (!given) return null;
  return (
    '--trust is deprecated and has no effect: it gates raw !html in popups and ' +
    'click.emit host events, and neither is part of a style.json. Remove it; ' +
    'a later release will remove it.'
  );
}

export const emitCommand = defineCommand({
  meta: {
    name: 'emit',
    description:
      'Export a map document to a standalone, spec-valid style.json',
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Path to a map document (YAML, JSON or TOML)',
    },
    strict: {
      type: 'boolean',
      description:
        'Fail if anything cannot export to style.json without changing the map',
    },
    'with-fallbacks': {
      type: 'boolean',
      description:
        'Export with a fallback where needed, and warn (the default)',
    },
    target: {
      type: 'string',
      description:
        'Target maplibre-gl version, e.g. 5.6.0. Gates state: support',
    },
    // No `trust` option: `--trust` is deprecated and has no effect, so it is
    // not listed in --help. It is still accepted; see trustFlagNote.
    out: {
      type: 'string',
      alias: 'o',
      description: 'Write the style to this file (or to style.json in this folder) instead of stdout',
    },
    'sprite-base': {
      type: 'string',
      description:
        'Absolute URL prefix where the sprite files will be served (required ' +
        'when the document generates sprite assets — MapLibre rejects relative ' +
        'sprite URLs, so the emitted style must carry the deployed location)',
    },
  },
  async run({ args, rawArgs }) {
    const filePath = resolve(args.file as string);

    const trustNote = trustFlagNote(rawArgs);
    if (trustNote) consola.warn(trustNote);

    let contents: string;
    try {
      contents = readFileSync(filePath, 'utf-8');
    } catch {
      logger.error(`Could not read ${filePath}`);
      process.exit(EXIT_CODES.FILE_NOT_FOUND);
    }

    // Only a `map` document compiles: scrollytelling and the pages format sit
    // outside the export claim by design, so reject them here rather than
    // producing a partial style.
    // The file extension picks YAML, JSON or TOML; errors name that format.
    const parsed = await parseDocumentText(contents, {
      kind: 'map',
      signals: { fileName: filePath },
    }).catch((err: unknown) => {
      // Only a failed load of the TOML reader rejects.
      logger.error(tomlReaderFailureMessage(err));
      return process.exit(EXIT_CODES.UNKNOWN_ERROR);
    });
    if (!parsed.success) {
      logger.error(`${filePath} is not a valid map document.`);
      for (const err of parsed.errors) {
        logger.error(`  ${err.path ? err.path + ': ' : ''}${err.message}${lineColumnSuffix(err)}`);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    if (args.strict && args['with-fallbacks']) {
      logger.error('Choose one of --strict or --with-fallbacks, not both.');
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
    const mode: EmitMode = args.strict ? 'strict' : 'with-fallbacks';

    // Trust gates `!html` popups and `emit` host events, which are runtime
    // behavior and never part of a style.json, so nothing here reads it.
    const policy: CapabilityPolicy = {
      trust: 'untrusted',
      ...(args.target ? { target: args.target as string } : {}),
    };

    let style: Record<string, unknown>;
    let warnings: EmitWarning[];
    let assets: EmitAsset[] | undefined;
    let images: EmitImageRef[] | undefined;
    try {
      ({ style, warnings, assets, images } = await emitStyle(parsed.data, mode, policy, {
        loadData: createDataLoader(filePath),
        documentPath: filePath,
      }));
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
    // export guarantee while looking like success.
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
      const outPath = resolveOutPath(args.out as string);

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
