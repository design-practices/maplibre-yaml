/**
 * @file Source schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/source
 *
 * @description
 * Zod schemas for all MapLibre data source types with runtime-first defaults.
 * Supports GeoJSON, vector, raster, image, and video sources with dynamic data loading.
 *
 * @example
 * ```typescript
 * import { GeoJSONSourceSchema, LayerSourceSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod";
import { LngLatSchema } from "./base.schema";

/**
 * WebSocket or Server-Sent Events streaming configuration.
 *
 * @remarks
 * Enables real-time data updates via WebSocket or SSE connections.
 *
 * **Connection Types:**
 * - `websocket` - Bidirectional WebSocket connection
 * - `sse` - Server-Sent Events (unidirectional)
 *
 * @example WebSocket
 * ```yaml
 * stream:
 *   type: websocket
 *   url: "wss://api.example.com/live-data"
 *   reconnect: true
 *   reconnectMaxAttempts: 10
 *   protocols: ["json", "v1"]
 * ```
 *
 * @example Server-Sent Events
 * ```yaml
 * stream:
 *   type: sse
 *   url: "https://api.example.com/events"
 *   eventTypes: ["update", "delete"]
 * ```
 */
export const StreamConfigSchema = z.object({
  type: z.enum(["websocket", "sse"]).describe("Streaming connection type"),
  url: z.string().url().optional().describe("WebSocket or SSE endpoint URL"),
  reconnect: z
    .boolean()
    .default(true)
    .describe("Automatically reconnect on disconnect"),
  reconnectMaxAttempts: z
    .number()
    .min(0)
    .default(10)
    .describe("Maximum number of reconnection attempts"),
  reconnectDelay: z
    .number()
    .min(100)
    .default(1000)
    .describe("Initial delay in milliseconds before reconnecting"),
  reconnectMaxDelay: z
    .number()
    .min(1000)
    .default(30000)
    .describe("Maximum delay in milliseconds for exponential backoff"),
  eventTypes: z
    .array(z.string())
    .optional()
    .describe("Event types to listen for (SSE only)"),
  protocols: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("WebSocket sub-protocols (WebSocket only)"),
});

/** Inferred type for stream configuration. */
export type StreamConfig = z.infer<typeof StreamConfigSchema>;

/**
 * Loading UI configuration for data fetching.
 *
 * @remarks
 * Controls the loading experience while data is being fetched.
 *
 * @example
 * ```yaml
 * loading:
 *   enabled: true
 *   message: "Loading earthquake data..."
 *   showErrorOverlay: true
 * ```
 */
export const LoadingConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Enable loading UI overlays"),
  message: z.string().optional().describe("Custom loading message to display"),
  showErrorOverlay: z
    .boolean()
    .default(true)
    .describe("Show error overlay on fetch failure"),
});

/** Inferred type for loading configuration. */
export type LoadingConfig = z.infer<typeof LoadingConfigSchema>;

/**
 * Cache configuration for data fetching.
 *
 * @remarks
 * Controls HTTP caching behavior for fetched data.
 *
 * @example
 * ```yaml
 * cache:
 *   enabled: true
 *   ttl: 300000  # 5 minutes
 * ```
 */
export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true).describe("Enable HTTP caching"),
  ttl: z
    .number()
    .positive()
    .optional()
    .describe("Cache TTL in milliseconds (overrides default)"),
});

/** Inferred type for cache configuration. */
export type CacheConfig = z.infer<typeof CacheConfigSchema>;

/**
 * Refresh configuration for polling updates.
 *
 * @remarks
 * Configures periodic data refresh with merge strategies.
 *
 * @example Replace Strategy
 * ```yaml
 * refresh:
 *   refreshInterval: 5000
 *   updateStrategy: replace
 * ```
 *
 * @example Merge Strategy
 * ```yaml
 * refresh:
 *   refreshInterval: 10000
 *   updateStrategy: merge
 *   updateKey: "vehicleId"
 * ```
 *
 * @example Append-Window Strategy
 * ```yaml
 * refresh:
 *   refreshInterval: 15000
 *   updateStrategy: append-window
 *   windowSize: 100
 *   windowDuration: 3600000  # 1 hour
 *   timestampField: "timestamp"
 * ```
 */
export const RefreshConfigSchema = z
  .object({
    refreshInterval: z
      .number()
      .min(1000)
      .optional()
      .describe("Polling interval in milliseconds (minimum 1000ms)"),
    updateStrategy: z
      .enum(["replace", "merge", "append-window"])
      .default("replace")
      .describe("How to merge incoming data with existing data"),
    updateKey: z
      .string()
      .optional()
      .describe("Property key for merge strategy (required for merge)"),
    windowSize: z
      .number()
      .positive()
      .optional()
      .describe("Maximum features to keep (append-window)"),
    windowDuration: z
      .number()
      .positive()
      .optional()
      .describe("Maximum age in milliseconds (append-window)"),
    timestampField: z
      .string()
      .optional()
      .describe("Property field containing timestamp (append-window)"),
  })
  .refine((data) => !(data.updateStrategy === "merge" && !data.updateKey), {
    message: "updateKey is required when updateStrategy is 'merge'",
  });

/** Inferred type for refresh configuration. */
export type RefreshConfig = z.infer<typeof RefreshConfigSchema>;

/**
 * GeoJSON data source configuration.
 *
 * @remarks
 * The primary data source type for maplibre-yaml. Supports multiple data
 * loading strategies:
 *
 * **Data Sources (one required):**
 * - `url` - Fetch GeoJSON from URL at runtime
 * - `data` - Inline GeoJSON object
 * - `stream` - Real-time WebSocket or SSE connection
 *
 * **Fetch Strategy:**
 * - `runtime` (default) - Fetch when map loads, keeps bundle small
 * - `build` - Fetch at build time, bundle with app
 * - `hybrid` - Build-time with runtime refresh
 *
 * **Real-time Updates:**
 * - Use `refreshInterval` for polling (minimum 1000ms)
 * - Use `stream` for WebSocket/SSE
 * - Configure `updateStrategy` for merge vs replace
 *
 * @example Basic URL Source
 * ```yaml
 * source:
 *   type: geojson
 *   url: "https://example.com/data.geojson"
 * ```
 *
 * @example Inline Data
 * ```yaml
 * source:
 *   type: geojson
 *   data:
 *     type: FeatureCollection
 *     features:
 *       - type: Feature
 *         geometry:
 *           type: Point
 *           coordinates: [-74.006, 40.7128]
 *         properties:
 *           name: "New York"
 * ```
 *
 * @example Polling Updates
 * ```yaml
 * source:
 *   type: geojson
 *   url: "https://api.example.com/live-data"
 *   refreshInterval: 15000
 *   loading:
 *     message: "Loading live data..."
 * ```
 *
 * @example WebSocket Streaming
 * ```yaml
 * source:
 *   type: geojson
 *   stream:
 *     type: websocket
 *     url: "wss://api.example.com/stream"
 *   updateStrategy: merge
 *   updateKey: "id"
 * ```
 *
 * @example Clustered Points
 * ```yaml
 * source:
 *   type: geojson
 *   url: "https://example.com/points.geojson"
 *   cluster: true
 *   clusterRadius: 50
 *   clusterMaxZoom: 14
 * ```
 *
 * @see {@link StreamConfigSchema} for streaming options
 * @see {@link LoadingConfigSchema} for loading UI options
 * @see {@link https://maplibre.org/maplibre-style-spec/sources/#geojson | MapLibre GeoJSON Source}
 */
export const GeoJSONSourceSchema = z
  .object({
    type: z.literal("geojson").describe("Source type"),
    url: z.string().url().optional().describe("URL to fetch GeoJSON data"),
    data: z.any().optional().describe("Inline GeoJSON object"),
    prefetchedData: z
      .any()
      .optional()
      .describe("Pre-fetched data from build time"),
    fetchStrategy: z
      .enum(["runtime", "build", "hybrid"])
      .default("runtime")
      .describe("When to fetch data: runtime (default), build, or hybrid"),
    stream: StreamConfigSchema.optional().describe(
      "WebSocket/SSE streaming configuration"
    ),
    refresh: RefreshConfigSchema.optional().describe(
      "Polling refresh configuration"
    ),
    // Legacy support for direct refresh properties
    refreshInterval: z
      .number()
      .min(1000)
      .optional()
      .describe(
        "Polling interval in milliseconds (legacy, use refresh.refreshInterval)"
      ),
    updateStrategy: z
      .enum(["replace", "merge", "append-window"])
      .optional()
      .describe("Update strategy (legacy, use refresh.updateStrategy)"),
    updateKey: z
      .string()
      .optional()
      .describe("Update key (legacy, use refresh.updateKey)"),
    loading: LoadingConfigSchema.optional().describe(
      "Loading UI configuration"
    ),
    cache: CacheConfigSchema.optional().describe("Cache configuration"),
    // MapLibre clustering options
    cluster: z.boolean().optional().describe("Enable point clustering"),
    clusterRadius: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Cluster radius in pixels (default: 50)"),
    clusterMaxZoom: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe("Maximum zoom level to cluster points"),
    clusterMinPoints: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Minimum points to form a cluster"),
    clusterProperties: z
      .record(z.any())
      .optional()
      .describe("Aggregate cluster properties"),
    // Additional MapLibre options (passthrough)
    tolerance: z.number().optional(),
    buffer: z.number().optional(),
    lineMetrics: z.boolean().optional(),
    generateId: z.boolean().optional(),
    promoteId: z.union([z.string(), z.record(z.string())]).optional(),
    attribution: z.string().optional(),
  })
  .passthrough()
  .refine((data) => data.url || data.data || data.prefetchedData, {
    message:
      "GeoJSON source requires at least one of: url, data, or prefetchedData. " +
      'Use "url" to fetch from an endpoint, "data" for inline GeoJSON, ' +
      'or "prefetchedData" for build-time fetched data.',
  });

/** Inferred type for GeoJSON source. */
export type GeoJSONSource = z.infer<typeof GeoJSONSourceSchema>;

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
 * @see {@link https://maplibre.org/maplibre-style-spec/sources/#vector | MapLibre Vector Source}
 */
export const VectorSourceSchema = z
  .object({
    type: z.literal("vector").describe("Source type"),
    url: z.string().url().optional().describe("TileJSON URL"),
    tiles: z
      .array(z.string().url())
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
    promoteId: z.union([z.string(), z.record(z.string())]).optional(),
    volatile: z.boolean().optional(),
  })
  .passthrough()
  .refine((data) => data.url || data.tiles, {
    message:
      'Vector source requires either "url" (TileJSON) or "tiles" (tile URL array). ' +
      "Provide at least one of these properties.",
  });

/** Inferred type for vector source. */
export type VectorSource = z.infer<typeof VectorSourceSchema>;

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
    url: z.string().url().optional().describe("TileJSON URL"),
    tiles: z
      .array(z.string().url())
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
    volatile: z.boolean().optional(),
  })
  .passthrough()
  .refine((data) => data.url || data.tiles, {
    message:
      'Raster source requires either "url" (TileJSON) or "tiles" (tile URL array). ' +
      "Provide at least one of these properties.",
  });

/** Inferred type for raster source. */
export type RasterSource = z.infer<typeof RasterSourceSchema>;

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
    url: z.string().url().describe("Image URL"),
    coordinates: z
      .tuple([LngLatSchema, LngLatSchema, LngLatSchema, LngLatSchema])
      .describe(
        "Four corner coordinates [topLeft, topRight, bottomRight, bottomLeft]"
      ),
  })
  .passthrough();

/** Inferred type for image source. */
export type ImageSource = z.infer<typeof ImageSourceSchema>;

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
      .array(z.string().url())
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
  ImageSourceSchema,
  VideoSourceSchema,
]);

/** Inferred type for any layer source. */
export type LayerSource = z.infer<typeof LayerSourceSchema>;
