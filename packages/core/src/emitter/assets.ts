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
export function hatchTileSvg(options: HatchTileOptions = {}): EmitAsset {
  const requestedAngle = options.angle ?? 45;
  const requestedSpacing = options.spacing ?? 8;
  const strokeWidth = options.strokeWidth ?? 1.5;
  const color = options.color ?? "#000000";
  const size = options.size ?? 32;

  // Seamlessness requires the line family to be PERIODIC over the tile in
  // both axes: size·sinθ and size·cosθ must be integer multiples of the
  // spacing, or every stroke jogs at every tile boundary (the default
  // 45°/8px/32px request is off by ~2.6px). Snap the requested (angle,
  // spacing) to the nearest seamless lattice: j and k count stroke crossings
  // along the tile's two axes.
  const theta = (requestedAngle * Math.PI) / 180;
  const j = Math.round((size * Math.abs(Math.sin(theta))) / requestedSpacing);
  const k = Math.round((size * Math.abs(Math.cos(theta))) / requestedSpacing);
  const safeJ = j === 0 && k === 0 ? 1 : j;
  const angle =
    Math.sign(Math.sin(theta) || 1) * ((Math.atan2(safeJ, k) * 180) / Math.PI);
  const spacing = size / Math.hypot(safeJ, k);

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
    // The slug names what the author ASKED for; the hash covers what the
    // snap actually produced (it hashes the SVG).
    name: assetName("hatch", [requestedAngle, requestedSpacing], svg),
    svg,
    width: size,
    height: size,
  };
}

/** Options for {@link pinSvg}. */
export interface PinOptions {
  /** Pin fill color. Defaults to MapLibre's default-marker blue. */
  color?: string;
  /** Scale multiplier over the default 27×41 pin. */
  size?: number;
}

/** MapLibre's default-marker blue, so an unstyled pin ejects looking native. */
export const DEFAULT_PIN_COLOR = "#3FB1CE";

/**
 * The default marker pin as a deterministic SVG asset (U5) — the raster half
 * of the markers fallback: a live `maplibregl.Marker` lowers to a symbol
 * layer whose icon is this teardrop, shaped and colored like MapLibre's own
 * default marker so the ejected map reads the same.
 */
export function pinSvg(options: PinOptions = {}): EmitAsset {
  const color = options.color ?? DEFAULT_PIN_COLOR;
  const size = options.size ?? 1;
  const width = Math.round(27 * size);
  const height = Math.round(41 * size);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 27 41">` +
    `<path fill="${color}" stroke="#ffffff" stroke-width="1.5" ` +
    `d="M13.5 0.75C6.6 0.75 1 6.35 1 13.25c0 9.5 12.5 26.5 12.5 26.5S26 22.75 26 13.25C26 6.35 20.4 0.75 13.5 0.75z"/>` +
    `<circle cx="13.5" cy="13.25" r="4.5" fill="#ffffff" opacity="0.9"/>` +
    `</svg>`;

  return {
    name: assetName("pin", [color.replace(/^#/, ""), size], svg),
    svg,
    width,
    height,
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
  const sorted = [...dedupeAssets(assets)].sort((a, b) => a.name.localeCompare(b.name));
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
 * Collapse duplicate names: identical content is the common legitimate case
 * (two constructs sharing a preset) and keeps one copy; same name with
 * DIFFERENT content is a collision that would silently render one authored
 * pattern as another — thrown, never shipped.
 */
export function dedupeAssets(assets: readonly EmitAsset[]): EmitAsset[] {
  const byName = new Map<string, EmitAsset>();
  for (const asset of assets) {
    const existing = byName.get(asset.name);
    if (existing === undefined) {
      byName.set(asset.name, asset);
      continue;
    }
    if (existing.svg !== asset.svg) {
      throw new Error(
        `[assets] sprite name "${asset.name}" is claimed by two different images — ` +
          "a name collision would silently render one authored pattern as another. " +
          "Rename one (the content hash should make this unreachable; if you hit it " +
          "organically, please report it)."
      );
    }
  }
  return [...byName.values()];
}

/**
 * Attach generated assets to an emit result: records the (deduped)
 * descriptors and declares the document sprite on the style root in the
 * spec's array form under {@link DOCUMENT_SPRITE_ID}.
 *
 * @remarks
 * MapLibre requires sprite URLs to be ABSOLUTE — it rejects a relative one
 * at load ("Invalid sprite URL, must be absolute"). Pass `spriteBaseUrl`
 * (the URL prefix where the sprite files will be served) to finalize the
 * entry here; without it the entry carries the relative placeholder
 * {@link DOCUMENT_SPRITE_ID}, which a consumer MUST rewrite before the style
 * loads — `mlym emit` refuses to ship it unfinalized (`--sprite-base`).
 * Merging with a basemap's own sprite happens later, in `mergeBasemap`.
 */
/**
 * Rewrite the document sprite's relative placeholder to an absolute URL.
 *
 * @remarks
 * The deployment-time half of the contract described on
 * {@link attachSpriteAssets}: producers attach with the placeholder (they
 * cannot know where the style will be served), and whoever writes the files
 * finalizes. Returns a new style; entries already absolute are untouched.
 */
export function finalizeSpriteBaseUrl(
  style: Record<string, unknown>,
  spriteBaseUrl: string
): Record<string, unknown> {
  const sprite = style["sprite"];
  if (!Array.isArray(sprite)) return style;
  const base = spriteBaseUrl.replace(/\/$/, "");
  const rewritten = sprite.map((entry) =>
    isSpriteEntry(entry) && entry.url === DOCUMENT_SPRITE_ID
      ? { ...entry, url: `${base}/${DOCUMENT_SPRITE_ID}` }
      : entry
  );
  return { ...style, sprite: rewritten };
}

function isSpriteEntry(value: unknown): value is { id: string; url: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string"
  );
}

export function attachSpriteAssets(
  result: EmitResult,
  assets: readonly EmitAsset[],
  spriteBaseUrl?: string
): EmitResult {
  if (assets.length === 0) return result;
  const url = spriteBaseUrl
    ? `${spriteBaseUrl.replace(/\/$/, "")}/${DOCUMENT_SPRITE_ID}`
    : DOCUMENT_SPRITE_ID;
  const style = { ...result.style };
  style["sprite"] = [{ id: DOCUMENT_SPRITE_ID, url }];
  return {
    ...result,
    style,
    assets: dedupeAssets([...(result.assets ?? []), ...assets]),
  };
}
