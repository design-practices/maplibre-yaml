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
