/**
 * @file GeoJSON source schema
 * @module @maplibre-yaml/core/schemas/sources/geojson
 *
 * @description
 * The `type: geojson` source: a GeoJSON, FlatGeobuf or GeoParquet file by
 * URL, inline data, or build-time data, with polling, streaming and
 * clustering options. Import it through `../source.schema`, the stable path.
 */

import { z } from "zod/v3";
import {
  ResourceURLSchema,
  SourceFormatSchema,
  SourceLoadSchema,
  SourceColumnsSchema,
  StreamConfigSchema,
  STREAM_START_HINT,
  LoadingConfigSchema,
  CacheConfigSchema,
  RefreshConfigSchema,
} from "./shared";

/**
 * GeoJSON data source configuration.
 *
 * @remarks
 * The primary data source type for maplibre-yaml. Supports multiple data
 * loading strategies:
 *
 * **Data Sources (one required):**
 * - `url` - Fetch GeoJSON from URL at runtime
 * - `data` - Inline GeoJSON object (an empty FeatureCollection to start blank)
 * - `prefetchedData` - Data fetched at build time
 *
 * A `stream` (WebSocket or SSE) adds to one of these; it is not a data source
 * on its own, and it connects only beside a `refresh` block.
 *
 * **Fetch Strategy:**
 * - `runtime` (default) - Fetch when map loads, keeps bundle small
 * - `build` - Fetch at build time, bundle with app
 * - `hybrid` - Build-time with runtime refresh
 *
 * **Real-time Updates:**
 * - Use `refreshInterval` for polling (minimum 1000ms)
 * - Use `stream` for WebSocket/SSE, with a `refresh` block beside it
 * - Configure `refresh.updateStrategy` for merge vs replace
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
 *   refresh:
 *     refreshInterval: 15000
 * ```
 *
 * @example WebSocket Streaming
 * ```yaml
 * source:
 *   type: geojson
 *   data: { type: FeatureCollection, features: [] }  # empty until messages arrive
 *   stream:
 *     type: websocket
 *     url: "wss://api.example.com/stream"
 *   refresh:
 *     updateStrategy: merge
 *     updateKey: "id"
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
 * @see {@link https://maplibre.org/maplibre-style-spec/sources/#geojson | MapLibre GeoJSON Source}
 */
/**
 * How a GeoJSON source's `fetchStrategy:` is read: `runtime` only.
 *
 * @remarks
 * `build` and `hybrid` were accepted and inert from the start (nothing in
 * maplibre-yaml fetches at build time) and warned since 0.9.1; they are
 * errors since 0.11 (ml-cxo). The error names the alternative: `prefetchedData`,
 * which the Astro loader fills. `runtime` stays accepted for one more
 * release, deprecated, because it names what always happens.
 */
export const FetchStrategySchema = z.enum(["runtime"], {
  errorMap: (issue, ctx) =>
    issue.code === "invalid_enum_value"
      ? { message: fetchStrategyRemovedMessage(issue.received) }
      : { message: ctx.defaultError },
});

/** The error for `fetchStrategy: build` / `hybrid` (and any other value). */
export function fetchStrategyRemovedMessage(received: unknown): string {
  return (
    `"fetchStrategy: ${String(received)}" is not supported: maplibre-yaml fetches a source's data ` +
    "in the browser when the map loads. To inline data fetched elsewhere (at build time, by a " +
    "script), write it under prefetchedData: — the Astro loader fills it for you. " +
    "Remove fetchStrategy:."
  );
}

export const GeoJSONSourceSchema = z
  .object({
    type: z.literal("geojson").describe("Source type"),
    url: ResourceURLSchema.optional().describe(
      "URL of a GeoJSON file, or of a FlatGeobuf (.fgb) or GeoParquet (.parquet) file"
    ),
    format: SourceFormatSchema.optional(),
    load: SourceLoadSchema.optional(),
    columns: SourceColumnsSchema.optional(),
    // v1 keeps `data` as `z.any()` deliberately (R2/R10 byte-for-byte compat):
    // MapLibre tolerates loosely-conformant geometry that `z.any()` admits, and
    // hard-failing existing v1 files would break the compat guarantee. The
    // strict RFC 7946 schema is applied as a HARD ERROR under format v2 only
    // (see geojson.schema.ts, composed in map-v2.schema.ts).
    // TODO(U4-followup): a non-fatal "warn under v1" for malformed inline
    // geometry is deferred — it needs version-aware geometry checks in the
    // collectWarnings walker (which does no geometry inspection today), more
    // than a local change. File as a follow-up bead rather than plumbing the
    // document version through the warning walker here.
    data: z.any().optional().describe("Inline GeoJSON object"),
    prefetchedData: z
      .any()
      .optional()
      .describe("Pre-fetched data from build time"),
    fetchStrategy: FetchStrategySchema.default("runtime").describe(
      "Deprecated: runtime is the only value and names what always happens (data is fetched in the browser when the map loads), so remove it. build and hybrid are errors: to inline data fetched elsewhere, write it under prefetchedData (the Astro loader fills it)"
    ),
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
        "Deprecated: use refresh.refreshInterval. Polling interval in milliseconds"
      ),
    updateStrategy: z
      .enum(["replace", "merge", "append-window"])
      .optional()
      .describe("Deprecated: use refresh.updateStrategy"),
    updateKey: z
      .string()
      .optional()
      .describe("Deprecated: use refresh.updateKey"),
    loading: LoadingConfigSchema.optional(),
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
    tolerance: z
      .number()
      .optional()
      .describe("Douglas-Peucker simplification tolerance (higher = simpler geometry)"),
    buffer: z
      .number()
      .optional()
      .describe("Tile buffer size on each side, in pixels at tile scale"),
    lineMetrics: z
      .boolean()
      .optional()
      .describe("Calculate line distance metrics (required for `line-gradient`)"),
    generateId: z
      .boolean()
      .optional()
      .describe("Assign feature ids from each feature's index (enables feature-state)"),
    promoteId: z
      .union([z.string(), z.record(z.string())])
      .optional()
      .describe(
        "Feature property to use as the feature id (for feature-state), or a " +
          "map of source-layer name to property name"
      ),
    attribution: z.string().optional().describe("Attribution text"),
  })
  .passthrough()
  // DX guard, not a security check. Both validations live in a single
  // superRefine to keep the schema's chained-method depth shallow -- adding
  // a second chained refine blows the inferred LayerSchema union past
  // TypeScript's serialization buffer (TS7056 on layer.schema.ts:856,911).
  .superRefine((d, ctx) => {
    if (!d.url && !d.data && !d.prefetchedData) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "GeoJSON source requires at least one of: url, data, or prefetchedData. " +
          'Use "url" to fetch from an endpoint, "data" for inline GeoJSON, ' +
          'or "prefetchedData" for build-time fetched data.' +
          (d.stream ? STREAM_START_HINT : ""),
      });
      return;
    }
    if (typeof d.data === "string" && /^(\.\.?|\/?src)\//.test(d.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data"],
        // Now that `url:` accepts same-origin paths, it is the field this
        // should point at: `data:` is for inline GeoJSON, `url:` is for
        // anything fetched. Both work at runtime, but recommending `url:`
        // keeps the two fields meaning distinct things.
        message:
          `GeoJSON source.data must be an inline GeoJSON object, not a path. ` +
          `"${d.data}" is a local source-directory path that won't resolve at runtime. ` +
          `Move the file to public/ and fetch it with "url":\n` +
          `  url: "/data/<filename>.geojson"`,
      });
    }
  });

/** Inferred type for GeoJSON source. */
export type GeoJSONSource = z.infer<typeof GeoJSONSourceSchema>;
