/**
 * @file Grid source schema
 * @module @maplibre-yaml/core/schemas/sources/grid
 *
 * @description
 * The `type: grid` source: a regular raster field on a latitude/longitude
 * grid that maplibre-yaml reads itself and page code samples by position.
 * Import it through `../source.schema`, the stable path.
 */

import { z } from "zod/v3";
import { ResourceURLSchema, LoadingConfigSchema, CacheConfigSchema } from "./shared";

/** How a grid's values are packed in the file (`encoding:`). */
export const GRID_ENCODINGS = ["rg-uv", "scalar-r", "nullschool-json", "geotiff"] as const;

/** One of {@link GRID_ENCODINGS}. */
export type GridEncoding = (typeof GRID_ENCODINGS)[number];

/**
 * A grid source: a regular raster field on a latitude/longitude grid that
 * page code samples by position, read by maplibre-yaml rather than drawn by
 * MapLibre (no layer type draws one yet).
 *
 * @remarks
 * Closed on purpose: MapLibre never reads this object, so there is no reason
 * to pass unknown keys through, and a misspelt key gets a did-you-mean
 * instead of silence. Zod's default strip object (not `.strict()`, not
 * marked open): the unknown-key walker only descends into a union member
 * whose parse succeeds, so a strict object would report a typo as a wrong
 * type rather than suggest the key.
 *
 * Cross-field rules (`bounds:` or `grid:` per encoding, `range:` per
 * encoding, `nodata:` shape, `bands:` only with geotiff, bounds order and
 * extent) live in `parser/grid-checks.ts`: the source union is at the
 * TypeScript instantiation-depth limit and cannot take another refinement.
 *
 * Geometry comes in two forms, never both: `bounds` are the cell edges, in
 * MapLibre's `[west, south, east, north]` order; `grid` names the nodes
 * (`lo1`/`la1` is the centre of node (0, 0), `dx` east and `dy` south, both
 * positive). `nullschool-json` and `geotiff` files carry their own geometry.
 *
 * @example
 * ```yaml
 * sources:
 *   temperature:
 *     type: grid
 *     url: data/temperature.png
 *     encoding: scalar-r
 *     bounds: [-180, -90, 180, 90]
 *     range: [193, 328]
 *     units: K
 *   current:
 *     type: grid
 *     url: data/current-uv.png
 *     encoding: rg-uv
 *     grid: { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 }
 *     range: [-5, 5]
 *     units: m/s
 *     nodata: { channel: a, equals: 0 }
 *   elevation:
 *     type: grid
 *     url: data/elevation.tif
 *     encoding: geotiff
 *     bands: [0]
 *     nodata: -9999
 * ```
 */
export const GridSourceSchema = z.object({
  type: z.literal("grid").describe("Source type"),
  url: ResourceURLSchema.describe("URL of the grid file (an image, a JSON header, or a GeoTIFF)"),
  encoding: z
    .enum(GRID_ENCODINGS)
    .describe(
      "How values are packed: rg-uv (two components in the red and green bytes), scalar-r (one value in the red byte), nullschool-json (header plus data arrays), geotiff (one or two bands)"
    ),
  bounds: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .optional()
    .describe("Cell edges as [west, south, east, north], for an image encoding (or use grid:)"),
  grid: z
    .object({
      nx: z.number().describe("Columns (nodes along a row)"),
      ny: z.number().describe("Rows"),
      lo1: z.number().describe("Longitude of the first node (centre of node 0, 0)"),
      la1: z.number().describe("Latitude of the first node (the top row)"),
      dx: z.number().describe("Spacing between columns in degrees, eastward; positive"),
      dy: z.number().describe("Spacing between rows in degrees, southward from la1; positive"),
    })
    .optional()
    .describe("Node geometry, for an image encoding (or use bounds:)"),
  range: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe("[lo, hi]: the values bytes 0 and 255 stand for (rg-uv and scalar-r only)"),
  units: z.string().optional().describe("Unit of the values, as a label (K, m/s, m …)"),
  nodata: z
    .union([
      z.number(),
      z.object({
        channel: z.enum(["r", "g", "b", "a"]).describe("The channel the rule reads"),
        below: z.number().optional().describe("A node is missing when the byte is below this"),
        above: z.number().optional().describe("A node is missing when the byte is above this"),
        equals: z.number().optional().describe("A node is missing when the byte equals this"),
      }),
    ])
    .optional()
    .describe(
      "Which nodes carry no value: { channel, below | above | equals } for an image encoding, a number for geotiff"
    ),
  bands: z
    .array(z.number())
    .optional()
    .describe("GeoTIFF band indices to read: [value] or [u, v] (geotiff only)"),
  attribution: z.string().optional().describe("Attribution text for the data"),
  loading: LoadingConfigSchema.optional(),
  cache: CacheConfigSchema.optional().describe("Cache configuration"),
});

/** Inferred type for a grid source. */
export type GridSource = z.infer<typeof GridSourceSchema>;
