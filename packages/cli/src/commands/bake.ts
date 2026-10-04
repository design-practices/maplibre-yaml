/**
 * @file The `mlym bake` command — reproducible textures for the classic presets
 *
 * @description
 * The Mapzen-classic presets (crosshatch, blueprint) are pure style spec, so
 * their whole look rides on `*-pattern` images. `mlym bake <preset> --out
 * <dir>` regenerates those images from their sources — Tangram's vendored
 * MIT textures for crosshatch, a generated drafting grid for blueprint — so
 * the committed PNGs a document references are never an unexplained blob.
 */

import { defineCommand } from 'citty';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import consola from 'consola';
import { logger } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';
import { BAKE_PRESETS, defaultAssetsDir } from '../lib/bake.js';

export const bakeCommand = defineCommand({
  meta: {
    name: 'bake',
    description: 'Bake the pattern textures a classic preset (crosshatch, blueprint) references',
  },
  args: {
    preset: {
      type: 'positional',
      required: false,
      description: `Preset to bake: ${Object.keys(BAKE_PRESETS).join(' | ')}`,
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Directory to write the baked images into (created if missing)',
    },
  },
  async run({ args }) {
    const name = args.preset as string | undefined;
    if (!name) {
      // The listing is the command's output, not a log line: plain stdout.
      console.log('Presets (mlym bake <preset> --out <dir>):');
      for (const [preset, def] of Object.entries(BAKE_PRESETS)) {
        console.log(`  ${preset} — ${def.description}`);
        console.log(`    → ${def.outputs.join(', ')}`);
      }
      return;
    }
    const preset = BAKE_PRESETS[name];
    if (!preset) {
      logger.error(
        `Unknown preset "${name}". Choose one of: ${Object.keys(BAKE_PRESETS).join(', ')}.`
      );
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
    if (!args.out) {
      logger.error('Pass --out <dir>: the directory the preset document loads its images from.');
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    const outDir = resolve(args.out as string);
    let files;
    try {
      files = await preset.bake(defaultAssetsDir());
    } catch (err) {
      logger.error(`Bake failed: ${(err as Error).message}`);
      process.exit(EXIT_CODES.UNKNOWN_ERROR);
    }
    mkdirSync(outDir, { recursive: true });
    for (const file of files) writeFileSync(join(outDir, file.filename), file.data);
    consola.success(`Baked ${files.map((f) => f.filename).join(', ')} → ${outDir}`);
  },
});
