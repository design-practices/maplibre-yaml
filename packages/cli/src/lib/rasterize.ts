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

/** Hard ceilings for author-declared image fetches. A doc handed to
 * `mlym emit` chooses the URLs, so the fetch must fail loudly after bounded
 * time/bytes instead of hanging the CLI or buffering an unbounded body; the
 * dimension cap keeps one oversized image from dictating a sprite sheet
 * beyond WebGL texture floors (assets.ts SHEET_WRAP_WIDTH reasoning). */
export const IMAGE_FETCH_TIMEOUT_MS = 30_000;
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_CSS_PX = 1024;
const FETCH_CONCURRENCY = 8;

/**
 * Fetch every image ref — the pipeline's second networked step, beside
 * `resolveBasemap`, and failure follows the same rule: an image the author
 * declared that cannot be fetched is an error, not a silent hole in the
 * sprite. Fetches run in bounded batches with per-request timeouts.
 */
export async function resolveImageRefs(
  refs: readonly EmitImageRef[],
  timeoutMs: number = IMAGE_FETCH_TIMEOUT_MS
): Promise<ResolvedImage[]> {
  const resolveOne = async (ref: EmitImageRef): Promise<ResolvedImage> => {
    if (!/^https?:/i.test(ref.url)) {
      throw new Error(
        `image "${ref.name}": "${ref.url}" is not an absolute http(s) URL — ` +
          'compile-time fetch has no page to resolve a relative URL against.'
      );
    }
    let response: Response;
    try {
      response = await fetch(ref.url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new Error(
          `image "${ref.name}": timed out after ${timeoutMs}ms fetching ${ref.url}`
        );
      }
      throw err;
    }
    if (!response.ok) {
      throw new Error(
        `image "${ref.name}": ${response.status} ${response.statusText} fetching ${ref.url}`
      );
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > IMAGE_MAX_BYTES) {
      throw new Error(
        `image "${ref.name}": ${data.length} bytes from ${ref.url} exceeds the ` +
          `${IMAGE_MAX_BYTES}-byte sprite-image ceiling`
      );
    }
    const meta = await sharp(data).metadata();
    if (!meta.width || !meta.height) {
      throw new Error(`image "${ref.name}": could not read dimensions from ${ref.url}`);
    }
    const density = ref.pixelRatio ?? 1;
    const width = Math.max(1, Math.round(meta.width / density));
    const height = Math.max(1, Math.round(meta.height / density));
    if (width > IMAGE_MAX_CSS_PX || height > IMAGE_MAX_CSS_PX) {
      throw new Error(
        `image "${ref.name}": ${width}x${height} CSS px exceeds the ` +
          `${IMAGE_MAX_CSS_PX}px sprite-entry ceiling — sprite icons should be small; ` +
          'declare pixelRatio for high-density sources.'
      );
    }
    return {
      name: ref.name,
      url: ref.url,
      data,
      width,
      height,
      ...(ref.sdf !== undefined ? { sdf: ref.sdf } : {}),
    };
  };

  const resolved: ResolvedImage[] = [];
  for (let i = 0; i < refs.length; i += FETCH_CONCURRENCY) {
    resolved.push(
      ...(await Promise.all(refs.slice(i, i + FETCH_CONCURRENCY).map(resolveOne)))
    );
  }
  return resolved;
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
// Param order note: `images` sits before `id` because every real caller
// passes (assets, images) and none has ever passed `id` positionally; this
// package is bin-only (no exports entry), so the ordering is revisitable if
// a programmatic entry point ever ships.
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
