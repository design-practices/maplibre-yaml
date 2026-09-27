/**
 * @file Sprite-sheet rasterization (U4, KTD3) — the CLI's half of the pipeline
 * @module @maplibre-yaml/cli/lib/rasterize
 *
 * @description
 * Core emits deterministic SVG descriptors; this module composites them into
 * `<id>.png` / `<id>.json` (+ `@2x` pair) with sharp. sharp lives here — a
 * cli dependency pinned exact — so `@maplibre-yaml/core` stays dependency-
 * free and platform-binary-free (KTD3).
 *
 * Determinism note: PNG *bytes* vary across libvips builds, so tests compare
 * decoded RGBA and the index JSON, and sharp is pinned exact to keep the
 * encoder stable within a lockfile.
 */

import sharp from 'sharp';
import {
  buildSpriteIndex,
  DOCUMENT_SPRITE_ID,
  type EmitAsset,
} from '@maplibre-yaml/core';

/** One file the rasterizer produced, ready to write beside the style. */
export interface SpriteFile {
  /** File name relative to the style's directory, e.g. `mlym@2x.png`. */
  filename: string;
  data: Buffer;
}

/**
 * Rasterize descriptors into the standard four-file sprite set
 * (`<id>.png`, `<id>.json`, `<id>@2x.png`, `<id>@2x.json`).
 */
export async function rasterizeSpriteFiles(
  assets: readonly EmitAsset[],
  id: string = DOCUMENT_SPRITE_ID
): Promise<SpriteFile[]> {
  const files: SpriteFile[] = [];

  for (const pixelRatio of [1, 2] as const) {
    const layout = buildSpriteIndex(assets, pixelRatio);
    const suffix = pixelRatio === 2 ? '@2x' : '';

    const composites = await Promise.all(
      layout.placements.map(async ({ asset, x, y }) => ({
        input: await sharp(Buffer.from(asset.svg))
          .resize(asset.width * pixelRatio, asset.height * pixelRatio)
          .png()
          .toBuffer(),
        left: x,
        top: y,
      }))
    );

    const sheet = await sharp({
      create: {
        width: Math.max(layout.width, 1),
        height: Math.max(layout.height, 1),
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    files.push(
      { filename: `${id}${suffix}.png`, data: sheet },
      {
        filename: `${id}${suffix}.json`,
        data: Buffer.from(JSON.stringify(layout.index, null, 2) + '\n', 'utf-8'),
      }
    );
  }

  return files;
}
