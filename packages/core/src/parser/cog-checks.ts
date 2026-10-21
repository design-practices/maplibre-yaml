/**
 * @file Static checks and defaults for COG sources (0.9, ml-cnv.2)
 * @module @maplibre-yaml/core/parser/cog-checks
 *
 * @description
 * What validation can tell from the document alone about a raster or
 * raster-dem source whose URL names a Cloud Optimized GeoTIFF (a `.tif`,
 * `.tiff` or `cog://` URL, or `format: cog`), in v1 and v2 maps and stories:
 *
 * | Authored | Result |
 * | --- | --- |
 * | `colorRamp.palette` not a palette name | error, with did-you-mean |
 * | `colorRamp.colors` entry not `#rrggbb` | error |
 * | `colorRamp.min` ≥ `max` (the message points at `reverse:`); `classes` more than the palette has | error |
 * | a qualitative palette (`okabe-ito`, `Set1` …) as a smooth ramp | warning: it blends unrelated colours |
 * | `tileSize` other than 256 on a COG | warning: the reader draws 256-pixel tiles |
 * | `colorRamp:` beside a `#…` fragment in the URL | warning: `colorRamp:` wins |
 * | `colorRamp:` on a raster-dem, or on a source that isn't a COG | warning: no effect |
 * | `encoding:` other than `mapbox` on a COG raster-dem | warning: the COG reader writes mapbox |
 *
 * {@link applyCogDefaults} also restores what the author did NOT write: the
 * source schemas default `tileSize` to 512 (MapLibre's own default), but the
 * COG reader draws 256-pixel tiles, so a COG source without an authored
 * `tileSize` gets 256 instead.
 */

import type { Document, LineCounter } from "yaml";
import { findPalette, paletteSizes, suggestPalette } from "../classify/palettes";
import { COG_TILE_SIZE, DEFAULT_RAMP_PALETTE, normalizeHex } from "../formats/cog-spec";
import { formatOfSource } from "../formats/detect";
import { sourcesOf, type SourceAt } from "./format-checks";
import { positionForPath, type ValidationWarning } from "./validation-utils";

interface CheckError {
  path: string;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a source reads a COG (by URL or `format:`, on a raster/raster-dem type). */
function readsCog(source: Obj): boolean {
  return (
    (source["type"] === "raster" || source["type"] === "raster-dem") &&
    formatOfSource(source) === "cog"
  );
}

/**
 * Check every COG source's `colorRamp:` and `encoding:`.
 *
 * @param value - The materialized document.
 * @param version - 1 for a v1 map or a story, 2 for a v2 map.
 * @param positions - The YAML document and line counter, when known.
 */
export function checkCogSources(
  value: unknown,
  version: 1 | 2,
  positions?: { doc: Document; lineCounter: LineCounter }
): { errors: CheckError[]; warnings: ValidationWarning[] } {
  const errors: CheckError[] = [];
  const warnings: ValidationWarning[] = [];
  if (!isObject(value)) return { errors, warnings };
  const at = (path: (string | number)[]) => {
    const p = positions ? positionForPath(positions.doc, positions.lineCounter, path) : undefined;
    return { path: path.join("."), ...(p ? { line: p.line, column: p.column } : {}) };
  };

  for (const { source, path, runtime, runtimePath } of sourcesOf(value, version)) {
    const cog = readsCog(source);
    const ramp = runtime["colorRamp"];
    const rampPath = [...runtimePath, "colorRamp"];

    if (cog && source["type"] === "raster-dem" && source["encoding"] !== undefined && source["encoding"] !== "mapbox") {
      warnings.push({
        ...at([...path, "encoding"]),
        message:
          `encoding: ${String(source["encoding"])} has no effect on a COG: its elevation is ` +
          "always delivered as mapbox (Terrain-RGB) tiles. Remove the line.",
      });
    }

    if (cog && typeof source["tileSize"] === "number" && source["tileSize"] !== COG_TILE_SIZE) {
      warnings.push({
        ...at([...path, "tileSize"]),
        message:
          `tileSize: ${source["tileSize"]} on a COG: the COG reader draws 256-pixel tiles, so at ` +
          `${source["tileSize"]} the image is drawn at the wrong resolution. Remove the line (a COG ` +
          "source uses 256).",
      });
    }

    if (ramp === undefined) continue;
    if (!cog) {
      warnings.push({
        ...at(rampPath),
        message:
          "colorRamp: only colours a Cloud Optimized GeoTIFF (a .tif or cog:// URL on a " +
          "type: raster source); it does nothing here.",
      });
      continue;
    }
    if (source["type"] === "raster-dem") {
      warnings.push({
        ...at(rampPath),
        message:
          "colorRamp: does nothing on a raster-dem source, which MapLibre reads as elevation. " +
          "To colour the same file, add a second source with type: raster and the colorRamp:.",
      });
      continue;
    }
    if (!isObject(ramp)) continue; // the schema reports the shape
    if (typeof source["url"] === "string" && source["url"].includes("#")) {
      warnings.push({
        ...at([...path, "url"]),
        message:
          "This URL already has a #… fragment; colorRamp: replaces it. Keep one of the two.",
      });
    }
    errors.push(...checkRamp(ramp, rampPath, at));
    const paletteName = typeof ramp["palette"] === "string" ? ramp["palette"] : undefined;
    const palette = paletteName ? findPalette(paletteName) : undefined;
    if (palette?.type === "qualitative" && ramp["classes"] === undefined) {
      warnings.push({
        ...at([...rampPath, "palette"]),
        message:
          `${palette.name} is a qualitative palette — unrelated colours for categories — so a smooth ` +
          "ramp blends them into in-between colours that mean nothing. For values, use a sequential " +
          "palette (viridis, YlGn …) or a diverging one (RdBu …); to keep these colours, add classes: " +
          "to draw flat classes.",
      });
    }
  }
  return { errors, warnings };
}

/** The ramp's own fields: palette name, colours, range, class count. */
function checkRamp(
  ramp: Obj,
  path: (string | number)[],
  at: (path: (string | number)[]) => { path: string; line?: number; column?: number }
): CheckError[] {
  const errors: CheckError[] = [];
  const palette = ramp["palette"];
  const colors = ramp["colors"];
  if (palette !== undefined && colors !== undefined) {
    errors.push({
      ...at([...path, "colors"]),
      message: "colorRamp: takes palette: or colors:, not both.",
    });
  }
  if (typeof palette === "string" && !findPalette(palette)) {
    const hint = suggestPalette(palette);
    errors.push({
      ...at([...path, "palette"]),
      message:
        `"${palette}" isn't a palette name` +
        (hint ? ` — did you mean "${hint}"?` : ".") +
        " Palettes are the ones classify: uses: viridis, cividis, the ColorBrewer names " +
        "(YlGn, RdBu, Spectral …), or give your own colors: [\"#…\", \"#…\"].",
      ...(hint ? { suggestion: hint } : {}),
    });
  }
  if (Array.isArray(colors)) {
    colors.forEach((color, i) => {
      if (normalizeHex(color)) return;
      errors.push({
        ...at([...path, "colors", i]),
        message: `colorRamp colours are written #rrggbb (or #rgb); "${String(color)}" isn't.`,
      });
    });
  }
  const { min, max } = ramp;
  if (typeof min === "number" && typeof max === "number" && !(min < max)) {
    errors.push({
      ...at([...path, "max"]),
      message:
        `colorRamp: max (${max}) must be greater than min (${min}). To run the colours from high ` +
        "values to low, keep min below max and add reverse: true.",
    });
  }
  const classes = ramp["classes"];
  if (typeof classes === "number" && colors === undefined) {
    const found = findPalette(typeof palette === "string" ? palette : DEFAULT_RAMP_PALETTE);
    const sizes = found ? paletteSizes(found) : [];
    const largest = sizes[sizes.length - 1];
    if (found && largest !== undefined && classes > largest) {
      errors.push({
        ...at([...path, "classes"]),
        message: `${found.name} has at most ${largest} classes; colorRamp asks for ${classes}.`,
      });
    }
  }
  return errors;
}

/**
 * A COG source without an authored `tileSize` draws 256-pixel tiles: undo
 * the schema's 512 default on the parsed document (raw `value` says what the
 * author wrote; `data` is what the schema produced from it).
 */
export function applyCogDefaults(data: unknown, value: unknown, version: 1 | 2): void {
  if (!isObject(data) || !isObject(value)) return;
  const parsed = new Map<string, SourceAt>(
    sourcesOf(data, version).map((s) => [s.path.join("."), s])
  );
  for (const { source, path } of sourcesOf(value, version)) {
    if (source["tileSize"] !== undefined || !readsCog(source)) continue;
    const target = parsed.get(path.join("."))?.source;
    if (target && target["tileSize"] === 512) target["tileSize"] = COG_TILE_SIZE;
  }
}
