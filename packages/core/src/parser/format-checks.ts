/**
 * @file Static checks for cloud-native sources (0.9, ml-cnv)
 * @module @maplibre-yaml/core/parser/format-checks
 *
 * @description
 * What validation can tell from the document alone — no network — about a
 * source that names a cloud-native file (`formats/detect.ts`), in v1 and v2
 * map documents and in stories, so `mlym validate`, the Astro content
 * loader and the browser all say the same thing:
 *
 * | Authored | Result |
 * | --- | --- |
 * | `type: pmtiles` / `fgb` / `parquet` / `cog` / `mbtiles` … | error at `type` with the fix ({@link formatTypeMessage}, via the parser's unknown-type path) |
 * | `.fgb` / `.parquet` URL (or `format:`) on a tile source | error: features, not tiles — use `type: geojson` |
 * | `.pmtiles` / `.tif` URL (or `format:`) on `type: geojson` | error: tiles, not features — use `type: vector` / `raster` |
 * | `refresh:` / `stream:` on a FlatGeobuf or GeoParquet source | error: live data isn't available for them yet |
 * | a recognized format this version doesn't read (none in 0.9) | warning: recognized, not read by this version |
 * | COG `colorRamp:`, `encoding:`, `tileSize:` | see `cog-checks.ts` |
 * | `format:` disagreeing with the URL | warning: `format:` wins |
 * | `load:` on a source that isn't FlatGeobuf or GeoParquet | warning: no effect |
 * | `columns:` on a source that isn't GeoParquet | warning: no effect |
 *
 * Cross-field rules live here, not as schema refinements: another chained
 * refinement on a source schema pushes the layer union past TypeScript's
 * serialization limit (TS7056, see `source.schema.ts`).
 */

import type { Document, LineCounter } from "yaml";
import {
  FORMAT_INFO,
  formatFromUrl,
  formatNamedAsType,
  isCloudFormat,
  SUPPORTED_FORMATS,
  type CloudFormat,
} from "../formats/detect";
import { positionForPath, type ValidationWarning } from "./validation-utils";

/** An error a check found (the parser's ParseError shape). */
interface FormatCheckError {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export { formatTypeMessage } from "./format-messages";

/** One source the checks visit: the object, its path, and where its runtime keys sit. */
export interface SourceAt {
  source: Obj;
  path: (string | number)[];
  /** The object holding `format`/`load`/`refresh` (the source in v1, `runtime:` in v2). */
  runtime: Obj;
  runtimePath: (string | number)[];
}

/** Every source object of a document (named, then inline on layers). */
export function sourcesOf(value: Obj, version: 1 | 2): SourceAt[] {
  const root = version === 2 ? value["style"] : value;
  if (!isObject(root)) return [];
  const base: (string | number)[] = version === 2 ? ["style"] : [];
  const out: SourceAt[] = [];
  const add = (source: unknown, path: (string | number)[]) => {
    if (!isObject(source)) return;
    const runtime = version === 2 && isObject(source["runtime"]) ? source["runtime"] : version === 2 ? {} : source;
    out.push({ source, path, runtime, runtimePath: version === 2 ? [...path, "runtime"] : path });
  };
  const sources = root["sources"];
  if (isObject(sources)) {
    for (const [name, source] of Object.entries(sources)) add(source, [...base, "sources", name]);
  }
  const layers = root["layers"];
  if (Array.isArray(layers)) {
    layers.forEach((layer, i) => {
      if (isObject(layer)) add(layer["source"], [...base, "layers", i, "source"]);
    });
  }
  return out;
}

/** A label for the URL in messages (or the format, when only `format:` says it). */
function fileLabel(url: unknown, format: CloudFormat): string {
  return typeof url === "string" && url !== "" ? `"${url}"` : `this ${FORMAT_INFO[format].label} source`;
}

/** The message for a format on a source type that can't draw it. */
function mismatchMessage(format: CloudFormat, url: unknown): string {
  const file = fileLabel(url, format);
  switch (format) {
    case "pmtiles":
      return (
        `${file} is a PMTiles archive: it holds tiles, not GeoJSON features. Use type: vector ` +
        "(or raster / raster-dem for image or elevation tiles)."
      );
    case "cog":
      return (
        `${file} is a GeoTIFF: an image, not GeoJSON features. Use type: raster ` +
        "(or raster-dem for elevation)."
      );
    case "flatgeobuf":
      return `${file} is a FlatGeobuf file: it holds features, not tiles. Use type: geojson.`;
    case "geoparquet":
      return `${file} is a GeoParquet file: it holds features, not tiles. Use type: geojson.`;
  }
}

/**
 * The "recognized, not read" warning for a format in CLOUD_FORMATS that this
 * version doesn't read. Every format is read in 0.9, so this only fires if a
 * format is recognized ahead of its reader again.
 */
function notYetMessage(format: CloudFormat, url: unknown): string {
  const file = fileLabel(url, format);
  return (
    `${file} is a ${FORMAT_INFO[format].label} file, which this version of maplibre-yaml ` +
    "can't read: the source stays empty. Update maplibre-yaml, or convert the file to a " +
    "format this version reads."
  );
}

/** Formats read into a GeoJSON source, where `load:` applies. */
const FEATURE_FILE_FORMATS: ReadonlySet<CloudFormat | undefined> = new Set<CloudFormat | undefined>([
  "flatgeobuf",
  "geoparquet",
]);

/**
 * Run the cloud-native source checks on a materialized document.
 *
 * @param value - The document (after sugar expansion).
 * @param version - 1 for a v1 map or a story, 2 for a v2 map.
 * @param positions - The YAML document and line counter, when known.
 */
export function checkSourceFormats(
  value: unknown,
  version: 1 | 2,
  positions?: { doc: Document; lineCounter: LineCounter }
): { errors: FormatCheckError[]; warnings: ValidationWarning[] } {
  const errors: FormatCheckError[] = [];
  const warnings: ValidationWarning[] = [];
  if (!isObject(value)) return { errors, warnings };

  const at = (path: (string | number)[]) => {
    const p = positions ? positionForPath(positions.doc, positions.lineCounter, path) : undefined;
    return p ? { line: p.line, column: p.column } : {};
  };

  for (const { source, path, runtime, runtimePath } of sourcesOf(value, version)) {
    const type = source["type"];
    const url = source["url"];
    const declared = runtime["format"];
    const fromUrl = formatFromUrl(url);
    const format = isCloudFormat(declared) ? declared : fromUrl;

    // `format:` and the URL disagree: format wins (the URL may redirect).
    if (isCloudFormat(declared) && fromUrl && fromUrl !== declared) {
      warnings.push({
        path: [...runtimePath, "format"].join("."),
        message:
          `format: ${declared}, but the URL looks like a ${FORMAT_INFO[fromUrl].label} file; ` +
          `the source is read as ${FORMAT_INFO[declared].label} (format: wins).`,
        ...at([...runtimePath, "format"]),
      });
    }

    // `load:` only means something for FlatGeobuf and GeoParquet.
    if (runtime["load"] !== undefined && !FEATURE_FILE_FORMATS.has(format)) {
      warnings.push({
        path: [...runtimePath, "load"].join("."),
        message:
          "load: only applies to FlatGeobuf and GeoParquet sources (a .fgb or .parquet URL, " +
          "or format: flatgeobuf / geoparquet); it does nothing here.",
        ...at([...runtimePath, "load"]),
      });
    }

    // `columns:` only means something for GeoParquet.
    if (runtime["columns"] !== undefined && format !== "geoparquet") {
      warnings.push({
        path: [...runtimePath, "columns"].join("."),
        message:
          "columns: only applies to GeoParquet sources (a .parquet URL or format: geoparquet); " +
          "it does nothing here.",
        ...at([...runtimePath, "columns"]),
      });
    }

    if (!format) continue;
    const info = FORMAT_INFO[format];

    // A format on a source type that can't draw it.
    if (typeof type === "string" && formatNamedAsType(type) === undefined && !info.types.includes(type)) {
      if (["geojson", "vector", "raster", "raster-dem"].includes(type)) {
        errors.push({
          path: [...path, "type"].join("."),
          message: mismatchMessage(format, url),
          ...at([...path, "type"]),
        });
        continue;
      }
    }

    // Live data on a FlatGeobuf or GeoParquet source: rejected in 0.9.
    if (FEATURE_FILE_FORMATS.has(format)) {
      for (const key of ["refresh", "refreshInterval", "stream"]) {
        if (runtime[key] === undefined) continue;
        errors.push({
          path: [...runtimePath, key].join("."),
          message:
            `${key}: live data isn't available for ${info.label} sources yet. Remove it, or ` +
            "serve the data as GeoJSON for live updates.",
          ...at([...runtimePath, key]),
        });
      }
    }

    // Recognized, not read by this version: say so before the browser does.
    if (!SUPPORTED_FORMATS.has(format)) {
      warnings.push({
        path: [...path, isCloudFormat(declared) ? "format" : "url"].join("."),
        message: notYetMessage(format, url),
        ...at([...(isCloudFormat(declared) ? runtimePath : path), isCloudFormat(declared) ? "format" : "url"]),
        kind: "unimplemented",
      });
    }
  }
  return { errors, warnings };
}
