/**
 * @file Brotli for GeoParquet, as the `geoparquet-brotli` on-demand chunk sees it
 * @module @maplibre-yaml/core/formats/lib/geoparquet-brotli
 *
 * @description
 * Brotli's decoder is mostly its static dictionary (~68 KB gzip), and few
 * GeoParquet files use it (GeoPandas, GDAL and DuckDB default to snappy), so
 * it is a chunk of its own, fetched only for a file whose footer says
 * brotli. A leaf module: it imports nothing from core.
 */

export { decompressBrotli } from "hyparquet-compressors/src/brotli.js";
