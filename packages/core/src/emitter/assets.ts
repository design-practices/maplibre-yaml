/**
 * @file Sprite asset descriptors and index assembly (U4, R7 — KTD3/KTD6)
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * Shared infrastructure for every construct that exports via generated raster
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
 * resolve and never shadow basemap icons. The same `mlym:` prefix extends to
 * feature-property KEYS a lowering synthesizes (e.g. `mlym:icon` on the
 * markers source): synthesized properties are namespaced so they can never
 * collide with author data, a rule every future lowering inherits.
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
 * One image to fetch at compile time and merge into the document sprite
 * (U6, R9). Core *describes* — name, URL, flags — and the CLI fetches,
 * measures, and composites (KTD3's split, extended to the network step:
 * fetching lives beside `resolveBasemap`, the pipeline's one networked
 * stage). A programmatic consumer without the CLI receives everything
 * needed to resolve the refs itself.
 */
export interface EmitImageRef {
  /** Sprite entry name; layers reference it as `mlym:<name>`. */
  name: string;
  /** Where to fetch the image at emit time. */
  url: string;
  /** Signed-distance-field icon (tintable via `icon-color`). */
  sdf?: boolean;
  /** Source density — 2 means the file's pixels are @2x its CSS size. */
  pixelRatio?: number;
}

/**
 * KTD6 name for a URL-sourced image asset (marker icons): the content is
 * unknown until fetch, so the hash covers the URL — same URL, same name,
 * so a document referencing one icon twice yields one sprite entry.
 */
export function imageAssetName(url: string): string {
  return assetName("icon", [], url);
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

/** MapLibre's default-marker blue, so an unstyled pin exports looking native. */
export const DEFAULT_PIN_COLOR = "#3FB1CE";
/** The default pin's CSS-pixel footprint (matches MapLibre's own marker). */
export const DEFAULT_PIN_WIDTH = 27;
export const DEFAULT_PIN_HEIGHT = 41;

/**
 * The default marker pin as a deterministic SVG asset (U5) — the raster half
 * of the markers fallback: a live `maplibregl.Marker` lowers to a symbol
 * layer whose icon is this teardrop, shaped and colored like MapLibre's own
 * default marker so the exported map reads the same.
 */
export function pinSvg(options: PinOptions = {}): EmitAsset {
  // Schema-validated colors can't carry markup, but this is the last line of
  // defense for programmatic callers: strip anything that could break out of
  // the fill attribute.
  const color = (options.color ?? DEFAULT_PIN_COLOR).replace(/["'<>&]/g, "");
  const size = options.size ?? 1;
  const width = Math.round(DEFAULT_PIN_WIDTH * size);
  const height = Math.round(DEFAULT_PIN_HEIGHT * size);

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
  /** Present (true) only for SDF entries. */
  sdf?: boolean;
}

/**
 * What the shelf layout needs from an item: a name, CSS-pixel dimensions,
 * and content identity for dedupe. `EmitAsset` satisfies it via `svg`;
 * the CLI's fetched images satisfy it via `url` (+ optional `sdf`).
 */
export interface SpriteLayoutItem {
  name: string;
  width: number;
  height: number;
  svg?: string;
  url?: string;
  sdf?: boolean;
}

/** A computed sheet layout: index JSON plus the composite positions. */
export interface SpriteSheetLayout<T extends SpriteLayoutItem = EmitAsset> {
  /** The `<name>.json` sprite index, ready to serialize. */
  index: Record<string, SpriteIndexEntry>;
  /** Where each asset's raster lands on the sheet (in sheet pixels). */
  placements: { asset: T; x: number; y: number }[];
  /** Sheet dimensions in sheet pixels (already scaled by pixelRatio). */
  width: number;
  height: number;
}

/** Sheet-pixel width at which shelves wrap — comfortably under every
 * WebGL max-texture floor (4096) even at @2x, while keeping row packing
 * deterministic. Markers made asset counts author-driven (one pin per
 * distinct color/size), so unbounded single-row sheets are a real failure
 * mode, not a hypothetical. */
const SHEET_WRAP_WIDTH = 1024;

/**
 * Deterministic shelf layout: assets sorted by name, packed left-to-right,
 * wrapping to a new shelf at {@link SHEET_WRAP_WIDTH} sheet pixels.
 * Deterministic beats optimal here — a stable layout keeps emitted
 * artifacts diffable.
 */
export function buildSpriteIndex<T extends SpriteLayoutItem>(
  assets: readonly T[],
  pixelRatio: 1 | 2 = 1
): SpriteSheetLayout<T> {
  const sorted = [...dedupeAssets(assets)].sort((a, b) => a.name.localeCompare(b.name));
  // Null prototype: the index is a serialization buffer keyed by
  // author-influenced names — with a live prototype chain, a name like
  // `__proto__` would re-prototype the object and vanish from the JSON.
  const index: Record<string, SpriteIndexEntry> = Object.create(null);
  const placements: { asset: T; x: number; y: number }[] = [];

  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  let sheetWidth = 0;
  for (const asset of sorted) {
    const w = asset.width * pixelRatio;
    const h = asset.height * pixelRatio;
    if (x > 0 && x + w > SHEET_WRAP_WIDTH) {
      y += shelfHeight;
      x = 0;
      shelfHeight = 0;
    }
    index[asset.name] = {
      x,
      y,
      width: w,
      height: h,
      pixelRatio,
      ...(asset.sdf === true ? { sdf: true } : {}),
    };
    placements.push({ asset, x, y });
    x += w;
    if (h > shelfHeight) shelfHeight = h;
    if (x > sheetWidth) sheetWidth = x;
  }

  return { index, placements, width: sheetWidth, height: y + shelfHeight };
}

/**
 * Collapse duplicate names: identical content is the common legitimate case
 * (two constructs sharing a preset) and keeps one copy; same name with
 * DIFFERENT content is a collision that would silently render one authored
 * pattern as another — thrown, never shipped.
 */
export function dedupeAssets<T extends SpriteLayoutItem>(assets: readonly T[]): T[] {
  const byName = new Map<string, T>();
  for (const asset of assets) {
    const existing = byName.get(asset.name);
    if (existing === undefined) {
      byName.set(asset.name, asset);
      continue;
    }
    // Content identity: generated assets carry deterministic SVG; fetched
    // images carry the URL they came from.
    if ((existing.svg ?? existing.url) !== (asset.svg ?? asset.url)) {
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
/**
 * Declare the document sprite on a style root (KTD3's array form). The ONE
 * place the entry literal lives — projectStyle, attachSpriteAssets, and
 * attachSpriteImages all route through it, so the placeholder scheme cannot
 * drift between producers.
 */
export function declareDocumentSprite(
  style: Record<string, unknown>,
  spriteBaseUrl?: string
): Record<string, unknown> {
  const url = spriteBaseUrl
    ? `${spriteBaseUrl.replace(/\/$/, "")}/${DOCUMENT_SPRITE_ID}`
    : DOCUMENT_SPRITE_ID;
  return { ...style, sprite: [{ id: DOCUMENT_SPRITE_ID, url }] };
}

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
  return {
    ...result,
    style: declareDocumentSprite(result.style, spriteBaseUrl),
    assets: dedupeAssets([...(result.assets ?? []), ...assets]),
  };
}

/**
 * Attach fetch-at-emit image refs to an emit result — the {@link EmitImageRef}
 * analog of {@link attachSpriteAssets}: records the (deduped) refs and
 * declares the document sprite on the style root, since the style's
 * `mlym:<name>` references only resolve once the sprite exists.
 */
export function attachSpriteImages(
  result: EmitResult,
  images: readonly EmitImageRef[]
): EmitResult {
  if (images.length === 0) return result;
  const style = Array.isArray(result.style["sprite"])
    ? { ...result.style }
    : declareDocumentSprite(result.style);
  const byName = new Map<string, EmitImageRef>();
  for (const ref of [...(result.images ?? []), ...images]) {
    const existing = byName.get(ref.name);
    if (existing !== undefined && existing.url !== ref.url) {
      throw new Error(
        `[assets] sprite image name "${ref.name}" is claimed by two different URLs — ` +
          "a name collision would silently render one authored image as another. Rename one."
      );
    }
    if (existing === undefined) byName.set(ref.name, ref);
  }
  return { ...result, style, images: [...byName.values()] };
}
