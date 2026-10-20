/**
 * @file A COG source as MapLibre and the COG protocol read it (0.9, ml-cnv.2)
 * @module @maplibre-yaml/core/formats/cog-spec
 *
 * @description
 * An author writes a raster source with a `.tif` URL; the COG protocol
 * (`@geomatico/maplibre-cog-protocol`) reads `cog://<file URL>` with its
 * options in the URL fragment. This module is the one translation between
 * the two, shared by the renderer and `mlym emit` so the page and the
 * exported style agree:
 *
 * | Authored | Becomes |
 * | --- | --- |
 * | `url: data/x.tif` (or `cog://…`, or `format: cog`) | `url: cog://<absolute URL>` |
 * | `type: raster-dem` | `#dem` appended (the plugin's elevation mode), `encoding: mapbox` |
 * | `colorRamp: { palette, min, max }` on `type: raster` | `#color:[…colours],min,max,c` |
 * | no `tileSize` | `tileSize: 256` (the plugin draws 256-pixel tiles) |
 *
 * A fragment the author wrote themselves (`#color:BrewerSpectral9,-5,35,c`)
 * is kept as written; `colorRamp:` replaces it (validation warns).
 *
 * Pure: no DOM, no maplibre-gl, no plugin. The palette names are the ones
 * `classify:` uses (ColorBrewer, viridis, cividis, okabe-ito), resolved to
 * colours here, so the plugin's own list of ramp names never has to match.
 */

import { findPalette, paletteColors, paletteSizes } from "../classify/palettes";
import { stripScheme } from "./detect";

/** The tile size the COG protocol draws (MapLibre's default is 512). */
export const COG_TILE_SIZE = 256;

/** The palette a `colorRamp:` without `palette:` or `colors:` uses. */
export const DEFAULT_RAMP_PALETTE = "viridis";

/** `colorRamp:` on a single-band COG raster source. */
export interface ColorRamp {
  /** A palette name (as in `classify:`): `viridis`, `YlGn`, `RdBu` … */
  palette?: string;
  /** Explicit colours (`#rrggbb`), low to high — instead of `palette`. */
  colors?: string[];
  /** The value drawn in the first colour. */
  min: number;
  /** The value drawn in the last colour. */
  max: number;
  /** High values in the first colour instead. */
  reverse?: boolean;
  /** Draw this many flat classes instead of a smooth ramp. */
  classes?: number;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** `#abc` → `#aabbcc`; `#AABBCC` → `#aabbcc`; anything else → `undefined`. */
export function normalizeHex(color: unknown): string | undefined {
  if (typeof color !== "string") return undefined;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return undefined;
  const hex = m[1]!.toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
}

/**
 * The colours a ramp draws with, low to high (before `reverse`), or
 * `undefined` when the ramp names no usable colours (validation reports why).
 */
export function colorRampColors(ramp: Obj): string[] | undefined {
  const classes = typeof ramp["classes"] === "number" ? ramp["classes"] : undefined;
  if (Array.isArray(ramp["colors"])) {
    const colors = ramp["colors"].map(normalizeHex);
    return colors.length >= 2 && colors.every(Boolean) ? (colors as string[]) : undefined;
  }
  const name = typeof ramp["palette"] === "string" ? ramp["palette"] : DEFAULT_RAMP_PALETTE;
  const palette = findPalette(name);
  if (!palette) return undefined;
  if (classes !== undefined) return paletteColors(palette, classes);
  // A smooth ramp: the palette's richest set of stops.
  const sizes = paletteSizes(palette);
  return paletteColors(palette, sizes[sizes.length - 1]!);
}

/**
 * The plugin's `#color:` fragment for a ramp:
 * `#color:["#440154",…,"#fde725"],0,1,c` (`c` smooth, `-` reversed).
 *
 * @returns `undefined` when the ramp can't be drawn (no colours, or `min`
 *   / `max` missing) — validation has already said why.
 */
export function colorRampFragment(ramp: unknown): string | undefined {
  if (!isObject(ramp)) return undefined;
  const { min, max } = ramp;
  if (typeof min !== "number" || typeof max !== "number" || !(min < max)) return undefined;
  const colors = colorRampColors(ramp);
  if (!colors) return undefined;
  const smooth = ramp["classes"] === undefined;
  const modifiers = `${smooth ? "c" : ""}${ramp["reverse"] === true ? "-" : ""}`;
  return `#color:${JSON.stringify(colors)},${min},${max}${modifiers ? `,${modifiers}` : ""}`;
}

/** A URL split at its fragment (`x.tif#dem` → `["x.tif", "#dem"]`). */
function splitFragment(url: string): [string, string] {
  const hash = url.indexOf("#");
  return hash === -1 ? [url, ""] : [url.slice(0, hash), url.slice(hash)];
}

/**
 * The `cog://` URL for a COG source: the file URL (made absolute by
 * `absolute`, the renderer's page-relative resolver; the emitter keeps it as
 * written), then the fragment — the author's own, else `#dem` for elevation
 * or the `colorRamp:` colours.
 */
export function cogUrl(
  url: string,
  options: { type?: unknown; colorRamp?: unknown; absolute?: (url: string) => string } = {}
): string {
  const [file, authored] = splitFragment(stripScheme(url));
  const absolute = options.absolute ?? ((u: string) => u);
  let fragment = authored;
  if (options.type === "raster-dem") {
    fragment = authored || "#dem";
  } else if (options.colorRamp !== undefined) {
    fragment = colorRampFragment(options.colorRamp) ?? authored;
  }
  return `cog://${absolute(file)}${fragment}`;
}

/**
 * A COG source's spec as MapLibre should see it: the `cog://` URL,
 * `tileSize: 256` unless the author set one, `encoding: mapbox` for
 * elevation (what the plugin writes), and no `colorRamp` (ours).
 */
export function cogSourceSpec(spec: Obj, absolute?: (url: string) => string): Obj {
  const { colorRamp, ...rest } = spec;
  const url = typeof spec["url"] === "string" ? spec["url"] : "";
  const out: Obj = {
    ...rest,
    url: cogUrl(url, { type: spec["type"], colorRamp, ...(absolute ? { absolute } : {}) }),
    tileSize: typeof spec["tileSize"] === "number" ? spec["tileSize"] : COG_TILE_SIZE,
  };
  if (spec["type"] === "raster-dem") out["encoding"] = "mapbox";
  return out;
}
