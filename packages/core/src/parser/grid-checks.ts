/**
 * @file Static checks for grid sources (ml-nb1.2, U1)
 * @module @maplibre-yaml/core/parser/grid-checks
 *
 * @description
 * What validation can tell from the document alone about a `type: grid`
 * source — a regular raster field maplibre-yaml reads itself — in v1 and v2
 * maps and in stories. The schema (`GridSourceSchema`) holds the shape; the
 * rules that cross keys live here, because the source union is at the
 * TypeScript instantiation-depth limit and cannot take another refinement:
 *
 * | Authored | Result |
 * | --- | --- |
 * | `bounds:` and `grid:` together; neither on an image encoding | error |
 * | `bounds:` or `grid:` on `nullschool-json` / `geotiff` | error: the file carries its own geometry |
 * | `bounds:` out of order, more than 1° past the poles, or spanning more than the globe plus one column | error (lat/lon swap gets a did-you-mean) |
 * | `grid:` with a non-positive count or spacing, or a first node off the globe | error at the key |
 * | `range:` missing on `rg-uv` / `scalar-r`; present on the other two; `lo` not below `hi` | error |
 * | `nodata:` of the wrong shape for the encoding; any on `nullschool-json` | error |
 * | `bands:` without `geotiff`; not 1 or 2 whole numbers from 0 | error |
 * | `format:` on a grid | error pointing at `encoding:` |
 * | a layer whose `source:` is a grid (named or inline) | error at the layer's `source:` (no layer type draws a grid yet) |
 *
 * Sign conventions, as the messages state them: `bounds` are cell edges in
 * MapLibre's `[west, south, east, north]` order; `grid.lo1`/`la1` is the
 * centre of node (0, 0), `dx` counts eastward and `dy` southward, both
 * positive. A node-centred global grid's edges overshoot the poles by half a
 * cell, so `bounds` may pass ±90 by up to 1° (the cell height is unknown in
 * this form), and longitude may run to 361 (the globe plus one duplicated
 * column) or 1° past ±180.
 */

import type { Document, LineCounter } from "yaml";
import { GRID_ENCODINGS, type GridEncoding } from "../schemas/source.schema";
import { sourcesOf } from "./format-checks";
import { positionForPath, type ValidationWarning } from "./validation-utils";

/** An error this check found (the parser's ParseError shape). */
export interface GridCheckError {
  path: string;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

type Obj = Record<string, unknown>;
type Path = (string | number)[];
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Encodings whose file is an image: geometry and `range:` come from the document. */
const IMAGE_ENCODINGS: ReadonlySet<GridEncoding> = new Set<GridEncoding>(["rg-uv", "scalar-r"]);

/** How far `bounds` may pass ±90 latitude or the globe's longitude span, in degrees. */
const EDGE_TOLERANCE = 1;

/** The `format:` key on a grid. */
export const GRID_FORMAT_KEY_MESSAGE =
  "grid sources describe their pixel packing with encoding:, not format:.";

/** A layer whose `source:` names a grid source. */
export function layerOverGridMessage(sourceId: string): string {
  return (
    `"${sourceId}" is a grid source; no layer type draws a grid yet. ` +
    `Read its values from page code with getGrid("${sourceId}").sample(lngLat).`
  );
}

/** A layer whose inline `source:` is a grid. */
export function inlineGridMessage(layerId: string | undefined): string {
  return (
    `${layerId === undefined ? "This layer" : `Layer "${layerId}"`} has an inline grid source; ` +
    "no layer type draws a grid yet. Declare it under sources: and read its values from page " +
    "code with getGrid(id).sample(lngLat)."
  );
}

/**
 * Check every grid source's keys, and every layer drawn over a grid.
 *
 * @param value - The materialized document.
 * @param version - 1 for a v1 map or a story, 2 for a v2 map.
 * @param positions - The YAML document and line counter, when known.
 */
export function checkGridSources(
  value: unknown,
  version: 1 | 2,
  positions?: { doc: Document; lineCounter: LineCounter }
): { errors: GridCheckError[]; warnings: ValidationWarning[] } {
  const errors: GridCheckError[] = [];
  const warnings: ValidationWarning[] = [];
  if (!isObject(value)) return { errors, warnings };
  const at = (path: Path) => {
    const p = positions ? positionForPath(positions.doc, positions.lineCounter, path) : undefined;
    return { path: path.join("."), ...(p ? { line: p.line, column: p.column } : {}) };
  };
  const error = (path: Path, message: string, suggestion?: string) =>
    errors.push({ ...at(path), message, ...(suggestion ? { suggestion } : {}) });

  for (const { source, path, runtime, runtimePath } of sourcesOf(value, version)) {
    if (source["type"] !== "grid") continue;

    if (source["format"] !== undefined) error([...path, "format"], GRID_FORMAT_KEY_MESSAGE);
    if (version === 2 && runtime["format"] !== undefined) {
      error([...runtimePath, "format"], GRID_FORMAT_KEY_MESSAGE);
    }

    const encoding = source["encoding"];
    if (!(GRID_ENCODINGS as readonly unknown[]).includes(encoding)) continue; // the schema reports it
    const enc = encoding as GridEncoding;
    const image = IMAGE_ENCODINGS.has(enc);
    const { bounds, grid, range, nodata, bands } = source;

    // Geometry: bounds: or grid: for an image; neither for a file that has its own.
    if (image) {
      if (bounds !== undefined && grid !== undefined) {
        error([...path, "grid"], "A grid source takes bounds: or grid:, not both.");
      } else if (bounds === undefined && grid === undefined) {
        error(
          path,
          `encoding: ${enc} needs the field's geometry: bounds: [west, south, east, north] ` +
            "(cell edges) or grid: { nx, ny, lo1, la1, dx, dy } (nodes)."
        );
      }
    } else {
      for (const key of ["bounds", "grid"] as const) {
        if (source[key] !== undefined) {
          error([...path, key], `encoding: ${enc} reads the field's geometry from the file; remove ${key}:.`);
        }
      }
    }
    if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(isFinite)) {
      checkBounds(bounds as [number, number, number, number], [...path, "bounds"], error);
    }
    if (isObject(grid)) checkGrid(grid, [...path, "grid"], error);

    // range: the values bytes 0 and 255 stand for — image encodings only.
    if (image && range === undefined) {
      error(path, `encoding: ${enc} needs range: [lo, hi], the values bytes 0 and 255 stand for.`);
    } else if (!image && range !== undefined) {
      error([...path, "range"], `encoding: ${enc} carries physical values; remove range:.`);
    } else if (Array.isArray(range) && range.length === 2) {
      const [lo, hi] = range;
      if (isFinite(lo) && isFinite(hi) && !(lo < hi)) {
        error([...path, "range"], `range: [${lo}, ${hi}] must be [lo, hi] with lo below hi.`);
      }
    }

    // nodata: per encoding.
    if (nodata !== undefined) {
      if (enc === "nullschool-json") {
        error([...path, "nodata"], "encoding: nullschool-json marks missing nodes as null; remove nodata:.");
      } else if (enc === "geotiff") {
        if (!isFinite(nodata)) {
          error([...path, "nodata"], "nodata: on encoding: geotiff is a number, the file's missing-value marker.");
        }
      } else {
        const comparators = isObject(nodata)
          ? ["below", "above", "equals"].filter((k) => nodata[k] !== undefined).length
          : 0;
        if (!isObject(nodata) || comparators !== 1) {
          error(
            [...path, "nodata"],
            `nodata: on encoding: ${enc} is { channel: r | g | b | a, below | above | equals: n } ` +
              "with one comparator."
          );
        }
      }
    }

    // bands: geotiff only; one or two band indices.
    if (bands !== undefined) {
      if (enc !== "geotiff") {
        error([...path, "bands"], "bands: only applies to encoding: geotiff; remove it.");
      } else if (
        !Array.isArray(bands) ||
        bands.length < 1 ||
        bands.length > 2 ||
        !bands.every((b) => Number.isInteger(b) && (b as number) >= 0)
      ) {
        error([...path, "bands"], "bands: lists 1 or 2 band indices (whole numbers from 0).");
      }
    }
  }

  // A layer over a grid: nothing draws one yet.
  const root = version === 2 ? value["style"] : value;
  if (isObject(root) && Array.isArray(root["layers"])) {
    const base: Path = version === 2 ? ["style"] : [];
    const sources = isObject(root["sources"]) ? root["sources"] : {};
    root["layers"].forEach((layer, i) => {
      if (!isObject(layer)) return;
      const source = layer["source"];
      const layerId = typeof layer["id"] === "string" ? layer["id"] : undefined;
      if (typeof source === "string") {
        const named = sources[source];
        if (isObject(named) && named["type"] === "grid") {
          error([...base, "layers", i, "source"], layerOverGridMessage(source));
        }
      } else if (isObject(source) && source["type"] === "grid") {
        error([...base, "layers", i, "source"], inlineGridMessage(layerId));
      }
    });
  }

  return { errors, warnings };
}

/** `bounds: [west, south, east, north]`: order and extent. */
function checkBounds(
  [w, s, e, n]: [number, number, number, number],
  path: Path,
  error: (path: Path, message: string, suggestion?: string) => void
): void {
  const limit = 90 + EDGE_TOLERANCE;
  // Latitudes far off the globe while the longitudes fit it: the pairs are swapped.
  if ((Math.abs(s) > limit || Math.abs(n) > limit) && Math.abs(w) <= 90 && Math.abs(e) <= 90) {
    const meant = `[${s}, ${w}, ${n}, ${e}]`;
    error(
      path,
      `bounds: [${w}, ${s}, ${e}, ${n}] puts ${Math.abs(s) > limit ? s : n} where latitude goes. ` +
        `Bounds are [west, south, east, north], longitude first: did you mean ${meant}?`,
      meant
    );
    return;
  }
  if (!(s < n)) {
    error(path, `bounds: south (${s}) must be below north (${n}); bounds are [west, south, east, north].`);
  } else if (n > limit || s < -limit) {
    const [which, v] = n > limit ? ["north", n] : ["south", s];
    error(
      path,
      `bounds: ${which} (${v}) is more than ${EDGE_TOLERANCE}° beyond ±90. A node-centred grid's edges ` +
        `may overshoot the poles by up to one cell (at most ${EDGE_TOLERANCE}° here); anything further is a mistake.`
    );
  }
  if (!(w < e)) {
    error(path, `bounds: west (${w}) must be below east (${e}); bounds are [west, south, east, north].`);
  } else if (e - w > 360 + EDGE_TOLERANCE) {
    error(
      path,
      `bounds: spans ${e - w}° of longitude; a grid covers at most the globe plus one duplicated ` +
        `column (${360 + EDGE_TOLERANCE}°).`
    );
  } else if (w < -180 - EDGE_TOLERANCE || e > 360 + EDGE_TOLERANCE) {
    error(
      path,
      `bounds: longitude ${w < -180 - EDGE_TOLERANCE ? w : e} is more than ${EDGE_TOLERANCE}° outside [-180, 360].`
    );
  }
}

/** `grid: { nx, ny, lo1, la1, dx, dy }`: counts, spacings and the first node. */
function checkGrid(grid: Obj, path: Path, error: (path: Path, message: string) => void): void {
  const { nx, ny, lo1, la1, dx, dy } = grid;
  if (nx !== undefined && !(Number.isInteger(nx) && (nx as number) > 0)) {
    error([...path, "nx"], "grid.nx: must be a positive whole number of columns.");
  }
  if (ny !== undefined && !(Number.isInteger(ny) && (ny as number) > 0)) {
    error([...path, "ny"], "grid.ny: must be a positive whole number of rows.");
  }
  if (dx !== undefined && !(isFinite(dx) && dx > 0)) {
    error(
      [...path, "dx"],
      "grid.dx: must be a positive number: the column spacing in degrees, counted eastward from lo1."
    );
  }
  if (dy !== undefined && !(isFinite(dy) && dy > 0)) {
    error(
      [...path, "dy"],
      "grid.dy: must be a positive number: the row spacing in degrees, counted southward from la1 (the top row)."
    );
  }
  if (lo1 !== undefined && !(isFinite(lo1) && Math.abs(lo1) <= 360)) {
    error([...path, "lo1"], "grid.lo1: must be a longitude between -360 and 360.");
  }
  if (la1 !== undefined && !(isFinite(la1) && Math.abs(la1) <= 90)) {
    error([...path, "la1"], "grid.la1: must be a latitude between -90 and 90.");
  }
}
