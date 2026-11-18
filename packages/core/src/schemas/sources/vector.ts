/**
 * @file Vector tile source schema
 * @module @maplibre-yaml/core/schemas/sources/vector
 *
 * @description
 * The `type: vector` source: a TileJSON URL, a PMTiles archive or a tile URL
 * template array, in MVT or MLT. Import it through `../source.schema`, the
 * stable path.
 */

import { z } from "zod/v3";
import { ResourceURLSchema, SourceFormatSchema, TileURLTemplateSchema } from "./shared";

/**
 * Vector tile source configuration.
 *
 * @remarks
 * Vector tiles provide efficient rendering of large datasets.
 * Requires either a TileJSON URL or a tiles URL array.
 *
 * @example TileJSON URL
 * ```yaml
 * source:
 *   type: vector
 *   url: "https://api.maptiler.com/tiles/v3/tiles.json?key=YOUR_KEY"
 * ```
 *
 * @example Tiles Array
 * ```yaml
 * source:
 *   type: vector
 *   tiles:
 *     - "https://tile.example.com/{z}/{x}/{y}.pbf"
 *   minzoom: 0
 *   maxzoom: 14
 * ```
 *
 * `encoding` (0.10): the tiles' format, `mvt` (Mapbox Vector Tiles, the
 * default) or `mlt` (MapLibre Tiles, drawn by maplibre-gl 6 and later). A
 * PMTiles archive whose header says MLT gets `mlt` without it; a value
 * written here wins.
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/sources/#vector | MapLibre Vector Source}
 */
export const VectorSourceSchema = z
  .object({
    type: z.literal("vector").describe("Source type"),
    url: ResourceURLSchema.optional().describe(
      "TileJSON URL, or a PMTiles archive (.pmtiles or pmtiles://)"
    ),
    format: SourceFormatSchema.optional(),
    tiles: z
      .array(TileURLTemplateSchema)
      .optional()
      .describe("Tile URL template array"),
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
    promoteId: z
      .union([z.string(), z.record(z.string())])
      .optional()
      .describe(
        "Feature property to use as the feature id (for feature-state), or a " +
          "map of source-layer name to property name"
      ),
    volatile: z
      .boolean()
      .optional()
      .describe("Skip the tile cache (MapLibre `volatile`); for frequently changing tiles"),
    sparse: z
      .boolean()
      .optional()
      .describe(
        "Slice a missing tile from the nearest ancestor that exists instead of leaving a hole (MapLibre `sparse`, experimental; needs maplibre-gl 6.17 or later, older runtimes drop the key with a notice)"
      ),
    encoding: z
      .enum(["mvt", "mlt"])
      .optional()
      .describe(
        "The tiles' format: mvt (Mapbox Vector Tiles, the default) or mlt (MapLibre Tiles, maplibre-gl 6+). A PMTiles archive whose header says MLT gets mlt without it; a value written here wins"
      ),
  })
  .passthrough()
  .refine((data) => data.url || data.tiles, {
    message:
      'Vector source requires either "url" (TileJSON) or "tiles" (tile URL array). ' +
      "Provide at least one of these properties.",
  });

/** Inferred type for vector source. */
export type VectorSource = z.infer<typeof VectorSourceSchema>;
