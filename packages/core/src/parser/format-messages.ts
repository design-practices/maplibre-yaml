/**
 * @file The fix for a file format written as a source `type:` (0.9, ml-cnv)
 * @module @maplibre-yaml/core/parser/format-messages
 *
 * @description
 * Standalone (no parser imports) so the parser's "Unknown source type" path
 * in `validation-utils` can use it without an import cycle through
 * `format-checks`.
 */

import { formatNamedAsType } from "../formats/detect";

/**
 * The fix for a file format written as a source `type:` (`type: pmtiles`,
 * `type: fgb`, `type: mbtiles` …) — or `undefined` when `received` names no
 * format. Used by the parser's unknown-source-type path, so it applies to
 * every document shape (v1, v2, stories, pages).
 */
export function formatTypeMessage(received: unknown): string | undefined {
  const format = formatNamedAsType(received);
  if (!format) return undefined;
  const word = `"${String(received)}"`;
  switch (format) {
    case "pmtiles":
      return (
        `${word} is a file format, not a source type. Keep the url: and set type: vector ` +
        "(or raster / raster-dem for image or elevation tiles) — the .pmtiles file name " +
        "(or a pmtiles:// URL) tells maplibre-yaml how to read it."
      );
    case "flatgeobuf":
      return (
        `${word} is a file format, not a source type. Keep the url: and set type: geojson — ` +
        "the .fgb file name tells maplibre-yaml to read it as FlatGeobuf."
      );
    case "geoparquet":
      return (
        `${word} is a file format, not a source type: GeoParquet files are read with ` +
        "type: geojson. This version of maplibre-yaml can't read GeoParquet yet (it's " +
        "planned) — convert the file to FlatGeobuf or GeoJSON for now."
      );
    case "cog":
      return (
        `${word} is a file format, not a source type. Keep the url: and set type: raster ` +
        "(or raster-dem for elevation) — the .tif file name (or a cog:// URL) tells " +
        "maplibre-yaml to read it as a Cloud Optimized GeoTIFF."
      );
    case "mbtiles":
      return (
        `${word} is a file format a web browser can't read. Convert it to PMTiles ` +
        "(pmtiles convert in.mbtiles out.pmtiles) and use type: vector (or raster) " +
        "with url: out.pmtiles."
      );
  }
}
