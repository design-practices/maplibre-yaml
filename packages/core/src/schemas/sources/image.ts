/**
 * @file Image source schema
 * @module @maplibre-yaml/core/schemas/sources/image
 *
 * @description
 * The `type: image` source: one image anchored to four corner coordinates.
 * Import it through `../source.schema`, the stable path.
 */

import { z } from "zod/v3";
import { LngLatSchema } from "../base.schema";
import { ResourceURLSchema } from "./shared";

/**
 * Image source configuration.
 *
 * @remarks
 * Display a single image on the map anchored to geographic coordinates.
 * Useful for overlaying maps, floor plans, or custom imagery.
 *
 * **Coordinate Order:**
 * Four corners must be specified clockwise starting from top-left:
 * 1. Top-left
 * 2. Top-right
 * 3. Bottom-right
 * 4. Bottom-left
 *
 * @example
 * ```yaml
 * source:
 *   type: image
 *   url: "https://example.com/overlay.png"
 *   coordinates:
 *     - [-80.425, 46.437]  # top-left
 *     - [-71.516, 46.437]  # top-right
 *     - [-71.516, 37.936]  # bottom-right
 *     - [-80.425, 37.936]  # bottom-left
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/sources/#image | MapLibre Image Source}
 */
export const ImageSourceSchema = z
  .object({
    type: z.literal("image").describe("Source type"),
    url: ResourceURLSchema.describe("Image URL"),
    coordinates: z
      .tuple([LngLatSchema, LngLatSchema, LngLatSchema, LngLatSchema])
      .describe(
        "Four corner coordinates [topLeft, topRight, bottomRight, bottomLeft]"
      ),
  })
  .passthrough();

/** Inferred type for image source. */
export type ImageSource = z.infer<typeof ImageSourceSchema>;
