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
  type EmitImageRef,
} from '@maplibre-yaml/core';

/** One file the rasterizer produced, ready to write beside the style. */
export interface SpriteFile {
  /** File name relative to the style's directory, e.g. `mlym@2x.png`. */
  filename: string;
  data: Buffer;
}

/**
 * An {@link EmitImageRef} resolved: fetched, measured, ready to composite.
 * `width`/`height` are CSS pixels — the fetched pixels divided by the ref's
 * declared `pixelRatio` — so layout stays in the same unit as generated
 * assets.
 */
export interface ResolvedImage {
  name: string;
  url: string;
  data: Buffer;
  width: number;
  height: number;
  sdf?: boolean;
}

/**
 * Fetch every image ref — the pipeline's second networked step, beside
 * `resolveBasemap`, and failure follows the same rule: an image the author
 * declared that cannot be fetched is an error, not a silent hole in the
 * sprite.
 */
export async function resolveImageRefs(
  refs: readonly EmitImageRef[]
): Promise<ResolvedImage[]> {
  return Promise.all(
    refs.map(async (ref) => {
      if (!/^https?:/i.test(ref.url)) {
        throw new Error(
          `image "${ref.name}": "${ref.url}" is not an absolute http(s) URL — ` +
            'compile-time fetch has no page to resolve a relative URL against.'
        );
      }
      const response = await fetch(ref.url);
      if (!response.ok) {
        throw new Error(
          `image "${ref.name}": ${response.status} ${response.statusText} fetching ${ref.url}`
        );
      }
      const data = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(data).metadata();
      if (!meta.width || !meta.height) {
        throw new Error(`image "${ref.name}": could not read dimensions from ${ref.url}`);
      }
      const density = ref.pixelRatio ?? 1;
      return {
        name: ref.name,
        url: ref.url,
        data,
        width: Math.round(meta.width / density),
        height: Math.round(meta.height / density),
        ...(ref.sdf !== undefined ? { sdf: ref.sdf } : {}),
      };
    })
  );
}

/** True when the layout item is a generated SVG asset. */
function isSvgAsset(item: EmitAsset | ResolvedImage): item is EmitAsset {
  return 'svg' in item;
}

/**
 * Rasterize descriptors into the standard four-file sprite set
 * (`<id>.png`, `<id>.json`, `<id>@2x.png`, `<id>@2x.json`). Generated SVG
 * assets and fetched raster images share one sheet.
 */
export async function rasterizeSpriteFiles(
  assets: readonly EmitAsset[],
  images: readonly ResolvedImage[] = [],
  id: string = DOCUMENT_SPRITE_ID
): Promise<SpriteFile[]> {
  const files: SpriteFile[] = [];
  const items: (EmitAsset | ResolvedImage)[] = [...assets, ...images];

  for (const pixelRatio of [1, 2] as const) {
    const layout = buildSpriteIndex(items, pixelRatio);
    const suffix = pixelRatio === 2 ? '@2x' : '';

    const composites = await Promise.all(
      layout.placements.map(async ({ asset, x, y }) => ({
        input: await sharp(isSvgAsset(asset) ? Buffer.from(asset.svg) : asset.data)
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
