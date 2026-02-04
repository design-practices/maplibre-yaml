/**
 * @file Collection item-specific Content Collection schemas for Astro
 * @module @maplibre-yaml/astro/utils/collection-schemas
 *
 * @description
 * Pre-built Zod schemas for common collection item patterns with map integration.
 * These schemas make it easy to add location data, regions, or routes
 * to collection items using Astro Content Collections.
 *
 * ## Usage
 *
 * Import these schemas in your `src/content/config.ts` file and use them
 * to define collections for collection items with geographic data.
 *
 * @example Collection Item with Location
 * ```typescript
 * // src/content/config.ts
 * import { defineCollection } from 'astro:content';
 * import { getCollectionItemWithLocationSchema } from '@maplibre-yaml/astro';
 *
 * export const collections = {
 *   posts: defineCollection({
 *     type: 'content',
 *     schema: getCollectionItemWithLocationSchema()
 *   })
 * };
 * ```
 *
 * @example Extended Schema
 * ```typescript
 * import { getCollectionItemWithLocationSchema } from '@maplibre-yaml/astro';
 * import { z } from 'zod';
 *
 * const schema = getCollectionItemWithLocationSchema({
 *   author: z.string(),
 *   tags: z.array(z.string()),
 *   featured: z.boolean().default(false)
 * });
 * ```
 */

import { z } from "zod";

/**
 * Location coordinate pair schema.
 * @internal
 */
const CoordinatesSchema = z
  .tuple([z.number(), z.number()])
  .describe("Geographic coordinates [longitude, latitude]");

/**
 * Single location point schema.
 *
 * @remarks
 * Represents a point on the map with optional metadata for display.
 */
export const LocationPointSchema = z.object({
  coordinates: CoordinatesSchema,
  name: z.string().optional().describe("Location name for display"),
  description: z.string().optional().describe("Location description"),
  zoom: z.number().min(0).max(24).optional().describe("Suggested zoom level"),
  markerColor: z.string().optional().describe("Marker color (CSS color value)"),
});

/** Type for location point data. */
export type LocationPoint = z.infer<typeof LocationPointSchema>;

/**
 * Polygon region schema.
 *
 * @remarks
 * Represents a closed area on the map. Coordinates follow GeoJSON polygon
 * format: an array of linear rings, where each ring is an array of coordinates.
 * The first ring is the exterior boundary; subsequent rings are holes.
 */
export const RegionPolygonSchema = z.object({
  coordinates: z
    .array(z.array(CoordinatesSchema))
    .describe("Polygon coordinates (GeoJSON format)"),
  name: z.string().optional().describe("Region name"),
  description: z.string().optional().describe("Region description"),
  fillColor: z.string().optional().describe("Fill color (CSS color value)"),
  strokeColor: z.string().optional().describe("Stroke color (CSS color value)"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Fill opacity (0-1)"),
});

/** Type for region polygon data. */
export type RegionPolygon = z.infer<typeof RegionPolygonSchema>;

/**
 * Route/line schema.
 *
 * @remarks
 * Represents a path or route on the map as a series of coordinates.
 */
export const RouteLineSchema = z.object({
  coordinates: z
    .array(CoordinatesSchema)
    .min(2)
    .describe("Route coordinates (array of [lng, lat] pairs)"),
  name: z.string().optional().describe("Route name"),
  description: z.string().optional().describe("Route description"),
  color: z.string().optional().describe("Line color (CSS color value)"),
  width: z.number().positive().optional().describe("Line width in pixels"),
});

/** Type for route line data. */
export type RouteLine = z.infer<typeof RouteLineSchema>;

/**
 * Creates a schema for collection items with optional single location.
 *
 * @param customFields - Additional fields to include in the schema
 * @returns Zod schema for collection items with location support
 *
 * @remarks
 * The location field is optional, allowing collection items with or without
 * geographic data in the same collection.
 *
 * **Included Fields:**
 * - `title` - Collection item title (required)
 * - `description` - Collection item description (optional)
 * - `pubDate` - Publication date (required)
 * - `updatedDate` - Last update date (optional)
 * - `location` - Single location point (optional)
 *
 * @example Basic Usage
 * ```typescript
 * // src/content/config.ts
 * import { defineCollection } from 'astro:content';
 * import { getCollectionItemWithLocationSchema } from '@maplibre-yaml/astro';
 *
 * export const collections = {
 *   posts: defineCollection({
 *     type: 'content',
 *     schema: getCollectionItemWithLocationSchema()
 *   })
 * };
 * ```
 *
 * @example Collection Item Frontmatter
 * ```yaml
 * ---
 * title: "My Trip to Paris"
 * pubDate: 2024-03-15
 * location:
 *   coordinates: [2.3522, 48.8566]
 *   name: "Paris, France"
 *   zoom: 12
 * ---
 * ```
 *
 * @example With Custom Fields
 * ```typescript
 * const schema = getCollectionItemWithLocationSchema({
 *   author: z.string(),
 *   tags: z.array(z.string()).default([]),
 *   heroImage: z.string().optional()
 * });
 * ```
 */
export function getCollectionItemWithLocationSchema(
  customFields?: z.ZodRawShape,
) {
  const baseSchema = z.object({
    title: z.string().describe("Post title"),
    description: z.string().optional().describe("Post description/excerpt"),
    pubDate: z.coerce.date().describe("Publication date"),
    updatedDate: z.coerce.date().optional().describe("Last updated date"),
    location: LocationPointSchema.optional().describe(
      "Single location for this post",
    ),
  });

  if (customFields) {
    return baseSchema.extend(customFields);
  }

  return baseSchema;
}

/**
 * Creates a schema for collection items with multiple locations.
 *
 * @param customFields - Additional fields to include in the schema
 * @returns Zod schema for collection items with multiple locations
 *
 * @remarks
 * Use this for posts that reference multiple places, such as travel
 * itineraries, restaurant reviews, or city guides.
 *
 * @example Travel Itinerary
 * ```yaml
 * ---
 * title: "10 Days in Japan"
 * pubDate: 2024-03-15
 * locations:
 *   - coordinates: [139.6917, 35.6895]
 *     name: "Tokyo"
 *   - coordinates: [135.7681, 35.0116]
 *     name: "Kyoto"
 *   - coordinates: [135.5023, 34.6937]
 *     name: "Osaka"
 * ---
 * ```
 */
export function getCollectionItemWithLocationsSchema(
  customFields?: z.ZodRawShape,
) {
  const baseSchema = z.object({
    title: z.string().describe("Post title"),
    description: z.string().optional().describe("Post description/excerpt"),
    pubDate: z.coerce.date().describe("Publication date"),
    updatedDate: z.coerce.date().optional().describe("Last updated date"),
    locations: z
      .array(LocationPointSchema)
      .optional()
      .describe("Multiple locations for this post"),
  });

  if (customFields) {
    return baseSchema.extend(customFields);
  }

  return baseSchema;
}

/**
 * Creates a schema for collection items with a region/area.
 *
 * @param customFields - Additional fields to include in the schema
 * @returns Zod schema for collection items with region support
 *
 * @remarks
 * Use this for collection items about specific areas, neighborhoods, or territories.
 *
 * @example Neighborhood Guide
 * ```yaml
 * ---
 * title: "Guide to Brooklyn Heights"
 * pubDate: 2024-03-15
 * region:
 *   name: "Brooklyn Heights"
 *   coordinates:
 *     - [[-73.998, 40.698], [-73.985, 40.698], [-73.985, 40.692], [-73.998, 40.692], [-73.998, 40.698]]
 *   fillColor: "#3388ff"
 *   fillOpacity: 0.3
 * ---
 * ```
 */
export function getCollectionItemWithRegionSchema(
  customFields?: z.ZodRawShape,
) {
  const baseSchema = z.object({
    title: z.string().describe("Post title"),
    description: z.string().optional().describe("Post description/excerpt"),
    pubDate: z.coerce.date().describe("Publication date"),
    updatedDate: z.coerce.date().optional().describe("Last updated date"),
    region: RegionPolygonSchema.optional().describe(
      "Geographic region for this post",
    ),
  });

  if (customFields) {
    return baseSchema.extend(customFields);
  }

  return baseSchema;
}

/**
 * Creates a schema for collection items with a route/trail.
 *
 * @param customFields - Additional fields to include in the schema
 * @returns Zod schema for collection items with route support
 *
 * @remarks
 * Use this for hiking guides, road trips, cycling routes, or any
 * content that follows a path.
 *
 * @example Hiking Trail Post
 * ```yaml
 * ---
 * title: "Appalachian Trail Section Hike"
 * pubDate: 2024-03-15
 * route:
 *   name: "Day 1 - Georgia to NC Border"
 *   coordinates:
 *     - [-84.1938, 34.6268]
 *     - [-84.1654, 34.6543]
 *     - [-84.1234, 34.6891]
 *   color: "#e74c3c"
 *   width: 3
 * ---
 * ```
 */
export function getCollectionItemWithRouteSchema(customFields?: z.ZodRawShape) {
  const baseSchema = z.object({
    title: z.string().describe("Post title"),
    description: z.string().optional().describe("Post description/excerpt"),
    pubDate: z.coerce.date().describe("Publication date"),
    updatedDate: z.coerce.date().optional().describe("Last updated date"),
    route: RouteLineSchema.optional().describe("Route/trail for this post"),
  });

  if (customFields) {
    return baseSchema.extend(customFields);
  }

  return baseSchema;
}

/**
 * Creates a flexible schema for collection items with any combination of
 * location, locations, region, and route.
 *
 * @param customFields - Additional fields to include in the schema
 * @returns Zod schema for collection items with full geographic support
 *
 * @remarks
 * This is the most flexible schema, allowing any collection item to include
 * any type of geographic data. Use when your collection has varied
 * geographic content types.
 *
 * @example Mixed Content Collection
 * ```typescript
 * // src/content/config.ts
 * export const collections = {
 *   posts: defineCollection({
 *     type: 'content',
 *     schema: getCollectionItemWithGeoSchema({
 *       author: z.string(),
 *       category: z.enum(['travel', 'hiking', 'city-guide', 'food'])
 *     })
 *   })
 * };
 * ```
 */
export function getCollectionItemWithGeoSchema(customFields?: z.ZodRawShape) {
  const baseSchema = z.object({
    title: z.string().describe("Post title"),
    description: z.string().optional().describe("Post description/excerpt"),
    pubDate: z.coerce.date().describe("Publication date"),
    updatedDate: z.coerce.date().optional().describe("Last updated date"),
    location: LocationPointSchema.optional().describe(
      "Single location for this collection item",
    ),
    locations: z
      .array(LocationPointSchema)
      .optional()
      .describe("Multiple locations for this collection item"),
    region: RegionPolygonSchema.optional().describe(
      "Geographic region for this collection item",
    ),
    route: RouteLineSchema.optional().describe(
      "Route/trail for this collection item",
    ),
  });

  if (customFields) {
    return baseSchema.extend(customFields);
  }

  return baseSchema;
}
