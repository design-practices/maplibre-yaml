/**
 * @file Source schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/source
 *
 * @description
 * Zod schemas for all MapLibre data source types with runtime-first defaults.
 * Supports GeoJSON, vector, raster, raster-dem, image, and video sources with dynamic data loading,
 * and the grid source (a sampleable raster field maplibre-yaml reads itself).
 *
 * This is the stable import path. Each source type lives in its own file
 * under `./sources/` (the helpers they share in `./sources/shared`); this
 * barrel re-exports every one of them and builds the union, so nothing
 * outside this folder needs to know the layout.
 *
 * @example
 * ```typescript
 * import { GeoJSONSourceSchema, LayerSourceSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod/v3";
import { markOpenSchema } from "../parser/validation-utils";
import { GeoJSONSourceSchema } from "./sources/geojson";
import { VectorSourceSchema } from "./sources/vector";
import { RasterSourceSchema } from "./sources/raster";
import { RasterDEMSourceSchema } from "./sources/raster-dem";
import { ImageSourceSchema } from "./sources/image";
import { VideoSourceSchema } from "./sources/video";
import { GridSourceSchema, type GridSource } from "./sources/grid";

export {
  SourceFormatSchema,
  ColorRampSchema,
  SourceLoadSchema,
  SourceColumnsSchema,
  StreamConfigSchema,
  type StreamConfig,
  STREAM_START_HINT,
  LoadingConfigSchema,
  type LoadingConfig,
  CacheConfigSchema,
  type CacheConfig,
  RefreshConfigSchema,
  type RefreshConfig,
} from "./sources/shared";
export { GeoJSONSourceSchema, FetchStrategySchema, fetchStrategyRemovedMessage, type GeoJSONSource } from "./sources/geojson";
export { VectorSourceSchema, type VectorSource } from "./sources/vector";
export { RasterSourceSchema, type RasterSource } from "./sources/raster";
export { RasterDEMSourceSchema, type RasterDEMSource } from "./sources/raster-dem";
export { ImageSourceSchema, type ImageSource } from "./sources/image";
export { VideoSourceSchema, type VideoSource } from "./sources/video";
export { GRID_ENCODINGS, type GridEncoding, GridSourceSchema, type GridSource } from "./sources/grid";

/** Whether a source spec (named or inline, parsed or raw) declares a grid: `type: "grid"`. */
export function isGridSource(spec: unknown): spec is GridSource {
  return typeof spec === "object" && spec !== null && (spec as { type?: unknown }).type === "grid";
}

/**
 * Union of all layer source types.
 *
 * @remarks
 * Use the `type` field to determine which source type is being used.
 *
 * @example
 * ```typescript
 * const source: LayerSource = {
 *   type: 'geojson',
 *   url: 'https://example.com/data.geojson'
 * };
 *
 * // TypeScript knows the available fields based on type
 * if (source.type === 'geojson') {
 *   console.log(source.refreshInterval); // OK
 * }
 * ```
 */
export const LayerSourceSchema = z.union([
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  RasterDEMSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
  GridSourceSchema,
]);

/** Inferred type for any layer source. */
export type LayerSource = z.infer<typeof LayerSourceSchema>;

// Source schemas are intentional MapLibre passthrough objects (`.passthrough()`):
// they accept arbitrary valid source options (maxzoom, minzoom, cluster,
// clusterRadius, buffer, tolerance, promoteId, attribution, ...). Exempt them
// from unknown-key warnings so valid-but-unlisted options are not flagged.
// (Authored styling objects — layers/paint/layout — are deliberately NOT
// exempt so paint-key typos like `circle-radis` keep being caught.)
markOpenSchema(GeoJSONSourceSchema);
markOpenSchema(VectorSourceSchema);
markOpenSchema(RasterSourceSchema);
markOpenSchema(RasterDEMSourceSchema);
markOpenSchema(ImageSourceSchema);
markOpenSchema(VideoSourceSchema);
// GridSourceSchema is deliberately NOT open: MapLibre never reads a grid, so
// an unknown key there is a typo to report, not an option to forward.
