/**
 * @file Raster DEM source schema
 * @module @maplibre-yaml/core/schemas/sources/raster-dem
 *
 * @description
 * The `type: raster-dem` source: elevation tiles for `hillshade` layers and
 * map-level `terrain:`, with the RGB `encoding`. Import it through
 * `../source.schema`, the stable path.
 */

import { z } from "zod/v3";
import { ResourceURLSchema, SourceFormatSchema, TileURLTemplateSchema } from "./shared";

/**
 * Raster DEM (digital elevation model) source configuration.
 *
 * @remarks
 * Elevation tiles consumed by `hillshade` layers and by map-level 3D
 * `terrain:` (`TerrainSchema` in map.schema). Shaped like
 * {@link RasterSourceSchema} — the same url-or-tiles requirement and
 * `tileSize` — plus the `encoding` that says how elevation is packed into
 * RGB. Custom encodings carry `redFactor`/`greenFactor`/`blueFactor`/
 * `baseShift` through passthrough, matching MapLibre.
 *
 * Map-level 3D terrain was once a declared non-goal here; 0.7 (U15, ml-chh.5)
 * reversed that. Declare the DEM as a named source and point the document-root
 * `terrain: { source, exaggeration }` at it. `encoding` defaults to `mapbox`
 * even when `url:` points at a TileJSON that declares otherwise, so set it
 * explicitly for terrarium tiles.
 *
 * @example
 * ```yaml
 * source:
 *   type: raster-dem
 *   tiles:
 *     - "https://example.com/dem/{z}/{x}/{y}.png"
 *   encoding: terrarium
 *   tileSize: 256
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/sources/#raster-dem | MapLibre Raster DEM Source}
 */
export const RasterDEMSourceSchema = z
  .object({
    type: z.literal("raster-dem").describe("Source type"),
    url: ResourceURLSchema.optional().describe(
      "TileJSON URL, a PMTiles archive (.pmtiles or pmtiles://), or an elevation COG (.tif or cog://)"
    ),
    format: SourceFormatSchema.optional(),
    tiles: z
      .array(TileURLTemplateSchema)
      .optional()
      .describe("Tile URL template array"),
    tileSize: z
      .number()
      .int()
      .min(1)
      .default(512)
      .describe("Tile size in pixels"),
    encoding: z
      .enum(["terrarium", "mapbox", "custom"])
      .default("mapbox")
      .describe("How elevation is encoded in the tile's RGB channels"),
    minzoom: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe("Minimum zoom level"),
    maxzoom: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe("Maximum zoom level"),
    bounds: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .optional()
      .describe("Bounding box [west, south, east, north]"),
    attribution: z.string().optional().describe("Attribution text"),
    volatile: z
      .boolean()
      .optional()
      .describe("Skip the tile cache (MapLibre `volatile`); for frequently changing tiles"),
  })
  .passthrough()
  .refine((data) => data.url || data.tiles, {
    message:
      'Raster DEM source requires either "url" (TileJSON) or "tiles" (tile URL array). ' +
      "Provide at least one of these properties.",
  });

/** Inferred type for raster DEM source. */
export type RasterDEMSource = z.infer<typeof RasterDEMSourceSchema>;
