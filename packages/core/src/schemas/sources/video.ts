/**
 * @file Video source schema
 * @module @maplibre-yaml/core/schemas/sources/video
 *
 * @description
 * The `type: video` source: one or more video URLs anchored to four corner
 * coordinates. Import it through `../source.schema`, the stable path.
 */

import { z } from "zod/v3";
import { LngLatSchema } from "../base.schema";
import { ResourceURLSchema } from "./shared";

/**
 * Video source configuration.
 *
 * @remarks
 * Display video content on the map anchored to geographic coordinates.
 * Multiple URLs can be provided for browser compatibility.
 *
 * @example
 * ```yaml
 * source:
 *   type: video
 *   urls:
 *     - "https://example.com/video.mp4"
 *     - "https://example.com/video.webm"
 *   coordinates:
 *     - [-122.51596391201019, 37.56238816766053]
 *     - [-122.51467645168304, 37.56410183312965]
 *     - [-122.51309394836426, 37.563391708549425]
 *     - [-122.51423120498657, 37.56161849366671]
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/sources/#video | MapLibre Video Source}
 */
export const VideoSourceSchema = z
  .object({
    type: z.literal("video").describe("Source type"),
    urls: z
      .array(ResourceURLSchema)
      .min(1)
      .describe("Array of video URLs for browser compatibility"),
    coordinates: z
      .tuple([LngLatSchema, LngLatSchema, LngLatSchema, LngLatSchema])
      .describe(
        "Four corner coordinates [topLeft, topRight, bottomRight, bottomLeft]"
      ),
  })
  .passthrough();

/** Inferred type for video source. */
export type VideoSource = z.infer<typeof VideoSourceSchema>;
