/**
 * @file Raster tile source schema
 * @module @maplibre-yaml/core/schemas/sources/raster
 *
 * @description
 * The `type: raster` source: a TileJSON URL, a PMTiles archive, a Cloud
 * Optimized GeoTIFF (with `colorRamp:` for a single band) or a tile URL
 * template array. Import it through `../source.schema`, the stable path.
 */

import { z } from "zod/v3";
import {
  ResourceURLSchema,
  SourceFormatSchema,
  ColorRampSchema,
  TileURLTemplateSchema,
} from "./shared";

/**
 * Raster tile source configuration.
 *
 * @remarks
 * Raster tiles for satellite imagery, hillshading, or other bitmap data.
 *
 * @example
 * ```yaml
 * source:
 *   type: raster
 *   tiles:
 *     - "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
 *   tileSize: 256
 *   maxzoom: 19
 *   attribution: "© OpenStreetMap contributors"
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/sources/#raster | MapLibre Raster Source}
 */
export const RasterSourceSchema = z
  .object({
    type: z.literal("raster").describe("Source type"),
    url: ResourceURLSchema.optional().describe(
      "TileJSON URL, a PMTiles archive (.pmtiles or pmtiles://), or a COG (.tif or cog://)"
    ),
    format: SourceFormatSchema.optional(),
    colorRamp: ColorRampSchema.optional(),
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
    scheme: z
      .enum(["xyz", "tms"])
      .optional()
      .describe("Tile coordinate scheme"),
    attribution: z.string().optional().describe("Attribution text"),
    volatile: z
      .boolean()
      .optional()
      .describe("Skip the tile cache (MapLibre `volatile`); for frequently changing tiles"),
  })
  .passthrough()
  .refine((data) => data.url || data.tiles, {
    message:
      'Raster source requires either "url" (TileJSON) or "tiles" (tile URL array). ' +
      "Provide at least one of these properties.",
  });

/** Inferred type for raster source. */
export type RasterSource = z.infer<typeof RasterSourceSchema>;
