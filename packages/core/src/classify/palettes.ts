/**
 * @file Named palettes for `classify:` — lookup, class counts, did-you-mean
 * @module @maplibre-yaml/core/classify/palettes
 *
 * @description
 * Palette names resolve to literal colours when the document is read, so
 * nothing about palettes exists at runtime or in an exported style: the
 * compiled `step`/`match` carries plain hex values.
 *
 * Names are matched case-insensitively (`blues`, `Blues`, `BLUES`), and a
 * near miss gets a did-you-mean. The canonical spelling is ColorBrewer's own
 * (`YlGnBu`), so a name copied from colorbrewer2.org, QGIS or d3 works as is.
 */

import { suggest } from "../utils/suggest";
import { PALETTE_DATA, type PaletteData } from "./palettes-data";

export type { PaletteData } from "./palettes-data";

/** The palette numeric classes use when none is named: CVD-safe, light to dark. */
export const DEFAULT_SEQUENTIAL_PALETTE = "YlGnBu";
/** The palette categories use when none is named: CVD-safe (Okabe & Ito). */
export const DEFAULT_QUALITATIVE_PALETTE = "okabe-ito";

const BY_LOWER = new Map<string, PaletteData>(
  PALETTE_DATA.map((p) => [p.name.toLowerCase(), p])
);

/** Every palette, in table order (ColorBrewer groups, then viridis, cividis, okabe-ito). */
export function listPalettes(): readonly PaletteData[] {
  return PALETTE_DATA;
}

/** The palette a name refers to (case-insensitive), or `undefined`. */
export function findPalette(name: string): PaletteData | undefined {
  return BY_LOWER.get(name.trim().toLowerCase());
}

/** The canonical palette name nearest to a misspelt one, or `undefined`. */
export function suggestPalette(name: string): string | undefined {
  const hit = suggest(name.trim().toLowerCase(), BY_LOWER.keys(), 3);
  return hit ? BY_LOWER.get(hit)?.name : undefined;
}

/** The class counts a palette offers, ascending. */
export function paletteSizes(palette: PaletteData): number[] {
  return Object.keys(palette.sizes)
    .map(Number)
    .sort((a, b) => a - b);
}

function unpack(packed: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 6 <= packed.length; i += 6) out.push(`#${packed.slice(i, i + 6)}`);
  return out;
}

/**
 * `n` colours from a palette, or `undefined` when it does not offer `n`.
 *
 * @remarks
 * Below the palette's smallest size (ColorBrewer starts at 3) the smallest
 * set is sampled evenly, keeping both ends — a quantile computation whose
 * values tie can collapse to two classes, and those should still read as
 * "low" and "high". Above the largest size there is no honest answer, so the
 * caller reports it.
 */
export function paletteColors(
  palette: PaletteData,
  n: number,
  reverse = false
): string[] | undefined {
  if (!Number.isInteger(n) || n < 1) return undefined;
  const sizes = paletteSizes(palette);
  const smallest = sizes[0]!;
  let colors: string[];
  if (palette.sizes[n] !== undefined) {
    colors = unpack(palette.sizes[n]!);
  } else if (n < smallest) {
    colors = sampleEvenly(unpack(palette.sizes[smallest]!), n);
  } else {
    return undefined;
  }
  return reverse ? colors.reverse() : colors;
}

/** `n` items from `list`, evenly spaced, keeping the ends (n ≤ list.length). */
export function sampleEvenly<T>(list: readonly T[], n: number): T[] {
  if (n >= list.length) return [...list];
  if (n === 1) return [list[Math.floor((list.length - 1) / 2)]!];
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]!);
  }
  return out;
}
