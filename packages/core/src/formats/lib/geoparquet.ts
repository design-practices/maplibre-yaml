/**
 * @file The GeoParquet library as the `geoparquet` on-demand chunk sees it
 * @module @maplibre-yaml/core/formats/lib/geoparquet
 *
 * @description
 * hyparquet (its browser-safe entry: the package's Node export adds a file
 * reader that imports `fs`) and the decompressors that ship with it: zstd,
 * gzip and lz4 (snappy is hyparquet's own). Brotli is its own chunk
 * (./geoparquet-brotli). A leaf module: it imports nothing from core (see
 * the seam, formats/decoders.ts); formats/geoparquet.ts, in the main bundle,
 * does the rest.
 */

import type { Compressors } from "hyparquet";
import type { Feature, Geometry } from "geojson";
import { decompress as zstd } from "fzstd";
import { gunzip } from "hyparquet-compressors/src/gzip.js";
import { decompressLz4, decompressLz4Raw } from "hyparquet-compressors/src/lz4.js";

export { parquetMetadataAsync, parquetReadObjects } from "hyparquet/src/index.js";

/** Codecs beyond snappy, keyed as hyparquet names them. */
export const compressors: Compressors = {
  GZIP: (input, length) => gunzip(input, new Uint8Array(length)),
  ZSTD: (input) => zstd(input),
  LZ4: decompressLz4,
  LZ4_RAW: decompressLz4Raw,
};

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Rows → GeoJSON features
// ---------------------------------------------------------------------------

/**
 * A value MapLibre can carry as a feature property: 64-bit integers become
 * numbers (or strings beyond 2^53), dates ISO strings, bytes are dropped.
 */
function propertyValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return undefined;
  if (Array.isArray(value)) return value.map(propertyValue);
  if (isObject(value)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) {
      const converted = propertyValue(v);
      if (converted !== undefined) out[k] = converted;
    }
    return out;
  }
  return value;
}

/** Rows (objects) to features: the geometry column becomes the geometry. */
export function toFeatures(rows: readonly Obj[], geometryColumn: string, columns: readonly string[]): Feature[] {
  const features: Feature[] = [];
  for (const row of rows) {
    const geometry = row[geometryColumn] as Geometry | null | undefined;
    if (!geometry || typeof geometry !== "object") continue;
    const properties: Obj = {};
    for (const name of columns) {
      if (name === geometryColumn) continue;
      const value = propertyValue(row[name]);
      if (value !== undefined) properties[name] = value;
    }
    features.push({ type: "Feature", geometry, properties });
  }
  return features;
}

