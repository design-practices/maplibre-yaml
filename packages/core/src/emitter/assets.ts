/**
 * @file Sprite asset descriptors and index assembly (U4, R7 — KTD3/KTD6)
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * Shared infrastructure for every construct that ejects via generated raster
 * assets: marker pins (U5), static pattern presets (U10), effect fallbacks
 * (U13). Core stays dependency-free (KTD3): this module produces
 * *descriptors* — deterministic SVG plus layout — and `@maplibre-yaml/cli`
 * rasterizes them with sharp. A programmatic consumer without the CLI still
 * receives everything needed to render the assets itself.
 *
 * Determinism is the contract everything here serves: the same document must
 * produce the same asset names (content-hashed, KTD6), the same sprite index
 * (name-sorted shelf layout), and — after the CLI's rasterizer — pixel-equal
 * sheets, so emitted artifacts diff cleanly in consumer repos.
 *
 * The prefixing rule (KTD3): the basemap keeps the `default` sprite id;
 * document-generated assets live under the fixed {@link DOCUMENT_SPRITE_ID}
 * id, and lowered layers reference icons as `mlym:<name>` — refs always
 * resolve and never shadow basemap icons.
 */

import type { EmitResult } from "./project";

/** The sprite id document-generated assets live under (KTD3). */
export const DOCUMENT_SPRITE_ID = "mlym";

/** One generated raster asset, described rather than rasterized. */
export interface EmitAsset {
  /** Sprite entry name; layers reference it as `mlym:<name>`. */
  name: string;
  /** Deterministic SVG source — the rasterizer's input. */
  svg: string;
  /** Layout size in CSS pixels (the @1x raster size). */
  width: number;
  height: number;
}

/**
 * 32-bit FNV-1a, hex-encoded — 8 chars, dependency-free, stable across
 * platforms. Not cryptographic; it only needs to make names collision-proof
 * across differing content (KTD6).
 */
export function contentHash8(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * KTD6 asset naming: readable param-derived prefix + content hash —
 * `fx-hatch-45-8-a1b2c3d4`. Debuggable in a sprite index, collision-proof
 * across parameter changes the slug doesn't capture.
 */
export function assetName(
  kind: string,
  params: ReadonlyArray<string | number>,
  content: string
): string {
  const slug = params
    .map((p) => String(p).replace(/[^a-zA-Z0-9]+/g, "_"))
    .join("-");
  return `fx-${kind}${slug ? `-${slug}` : ""}-${contentHash8(content)}`;
}

/** Options for {@link hatchTileSvg}. */
export interface HatchTileOptions {
  /** Stroke angle in degrees (45 = classic crosshatch diagonal). */
  angle?: number;
  /** Distance between stroke centerlines, px. */
  spacing?: number;
  /** Stroke width, px. */
  strokeWidth?: number;
  /** Stroke color (any CSS color). */
  color?: string;
  /** Tile edge length, px. Tiles this size repeat seamlessly. */
  size?: number;
}

/**
 * A seamlessly-tiling hatch tile — the crosshatch classic's raster
 * ingredient (U10) and this module's first concrete generator.
 *
 * @remarks
 * Seamlessness comes from drawing the stroke family across a 3×3 tile
 * neighborhood and clipping to the center tile, so a stroke exiting one edge
 * re-enters the opposite one exactly.
 */
export function hatchTileSvg(options: HatchTileOptions = {}): {
  asset: EmitAsset;
} {
  const angle = options.angle ?? 45;
  const spacing = options.spacing ?? 8;
  const strokeWidth = options.strokeWidth ?? 1.5;
  const color = options.color ?? "#000000";
  const size = options.size ?? 32;

  const lines: string[] = [];
  // Cover the diagonal of the 3×3 neighborhood so every rotation fills it.
  const span = size * 3;
  const count = Math.ceil((span * 1.5) / spacing);
  for (let i = -count; i <= count; i++) {
    const offset = i * spacing;
    lines.push(
      `<line x1="${-span}" y1="${offset}" x2="${span}" y2="${offset}" ` +
        `stroke="${color}" stroke-width="${strokeWidth}"/>`
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}">` +
    `<g transform="rotate(${angle} ${size / 2} ${size / 2})">` +
    lines.join("") +
    `</g></svg>`;

  return {
    asset: {
      name: assetName("hatch", [angle, spacing], svg),
      svg,
      width: size,
      height: size,
    },
  };
}

/** One sprite-index entry, per the MapLibre sprite index format. */
export interface SpriteIndexEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
}

/** A computed sheet layout: index JSON plus the composite positions. */
export interface SpriteSheetLayout {
  /** The `<name>.json` sprite index, ready to serialize. */
  index: Record<string, SpriteIndexEntry>;
  /** Where each asset's raster lands on the sheet (in sheet pixels). */
  placements: { asset: EmitAsset; x: number; y: number }[];
  /** Sheet dimensions in sheet pixels (already scaled by pixelRatio). */
  width: number;
  height: number;
}

/**
 * Deterministic shelf layout: assets sorted by name, packed left-to-right on
 * one shelf. Deterministic beats optimal here — sheets are small (pins,
 * tiles) and a stable layout keeps emitted artifacts diffable.
 */
export function buildSpriteIndex(
  assets: readonly EmitAsset[],
  pixelRatio: 1 | 2 = 1
): SpriteSheetLayout {
  const sorted = [...assets].sort((a, b) => a.name.localeCompare(b.name));
  const index: Record<string, SpriteIndexEntry> = {};
  const placements: { asset: EmitAsset; x: number; y: number }[] = [];

  let x = 0;
  let height = 0;
  for (const asset of sorted) {
    const w = asset.width * pixelRatio;
    const h = asset.height * pixelRatio;
    index[asset.name] = { x, y: 0, width: w, height: h, pixelRatio };
    placements.push({ asset, x, y: 0 });
    x += w;
    if (h > height) height = h;
  }

  return { index, placements, width: x, height };
}

/**
 * Attach generated assets to an emit result: records the descriptors and
 * declares the document sprite on the style root in the spec's array form,
 * under {@link DOCUMENT_SPRITE_ID} with a relative URL the CLI's file layout
 * satisfies (`mlym.png`/`mlym.json` beside the style). Merging with a
 * basemap's own sprite happens later, in `mergeBasemap`.
 */
export function attachSpriteAssets(
  result: EmitResult,
  assets: readonly EmitAsset[]
): EmitResult {
  if (assets.length === 0) return result;
  const style = { ...result.style };
  style["sprite"] = [{ id: DOCUMENT_SPRITE_ID, url: DOCUMENT_SPRITE_ID }];
  return {
    ...result,
    style,
    assets: [...(result.assets ?? []), ...assets],
  };
}
