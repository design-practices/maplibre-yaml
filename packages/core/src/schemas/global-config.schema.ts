/**
 * @file Site-wide map defaults for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/global-config
 *
 * @description
 * The Zod schema for a site-wide defaults file: the basemap, zoom and center
 * every map builder inherits unless a document sets its own. The Astro
 * integration reads one with `loadGlobalMapConfig`.
 *
 * @example
 * ```typescript
 * import { GlobalConfigSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod/v3";
import { LngLatSchema } from "./base.schema";
import { MapStyleSchema } from "./basemap.schema";

/**
 * Site-wide map defaults.
 *
 * @remarks
 * - `defaultMapStyle` - The basemap a map uses when it sets none
 * - `defaultZoom` / `defaultCenter` - The camera a builder uses when nothing
 *   else provides one
 *
 * @example
 * ```yaml
 * title: "My Map App"
 * description: "Interactive maps and stories"
 * defaultMapStyle: "https://tiles.openfreemap.org/styles/liberty"
 * defaultZoom: 10
 * defaultCenter: [-74.006, 40.7128]
 * ```
 */
export const GlobalConfigSchema = z
  .object({
    title: z.string().optional().describe("Application title"),
    description: z.string().optional().describe("Application description"),
    defaultMapStyle: MapStyleSchema.optional().describe(
      "Default map style: a style URL, a style object, or a Protomaps basemap ({ pmtiles, flavor, lang })",
    ),
    defaultZoom: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe("Default zoom level for all maps"),
    defaultCenter: LngLatSchema.optional().describe(
      "Default center [lng, lat] for all maps",
    ),
  })
  .describe("Site-wide map defaults");

/** Inferred type for the site-wide defaults. */
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
