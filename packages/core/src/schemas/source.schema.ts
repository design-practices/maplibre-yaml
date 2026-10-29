/**
 * @file Source schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/source
 *
 * @description
 * Zod schemas for all MapLibre data source types with runtime-first defaults.
 * Supports GeoJSON, vector, raster, raster-dem, image, and video sources with dynamic data loading.
 *
 * @example
 * ```typescript
 * import { GeoJSONSourceSchema, LayerSourceSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod";
import { LngLatSchema } from "./base.schema";
import { markOpenSchema } from "../parser/validation-utils";

/**
 * Something a browser can actually fetch: an absolute URL (any scheme), a
 * root-relative path, an explicitly-relative path, or a bare relative path.
 *
 * @remarks
 * This replaces `z.string().url()` on every source URL field. `.url()` demands
 * a fully-qualified URL, so it rejected `/data/points.geojson` — self-hosting
 * data alongside the page, an ordinary setup that works at runtime, since the
 * data layer passes the string straight to `fetch()` and MapLibre resolves
 * source URLs relative to the document (GH #39).
 *
 * Bare relative paths (`data/points.geojson`, `points.geojson`) are accepted
 * too (ml-zft): `fetch()` and MapLibre resolve them exactly like
 * `./data/points.geojson`, and rejecting them was the top trap for students
 * writing a plain-HTML page. Every relative form resolves against the PAGE
 * (`document.baseURI`), not against the YAML file that contains it.
 *
 * The bare-path branch only matches when nothing before the first `/`, `?`
 * or `#` contains a `:`, so it never widens what counts as a scheme; scheme
 * URLs are matched by the first branch exactly as before.
 *
 * A regex rather than a `new URL()` refinement, for two reasons. It keeps the
 * field a `ZodString`: a `.refine()` yields a `ZodEffects` whose larger type,
 * multiplied across seven fields inside the layer discriminated union, pushes
 * that union past TypeScript's serialization buffer (TS7056). And a regex
 * emits `pattern` into the published JSON Schema, so editors keep a real check
 * where a refinement would have emitted a bare string.
 *
 * Note this is a DX guard, not a security boundary — `.url()` accepted
 * `javascript:` too, since `new URL()` considers it well-formed. Scheme safety
 * is enforced where it matters, at the render sinks, by `safeUrl`.
 */
const FETCHABLE_REFERENCE =
  /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/|\.\.?\/|[^\s:/?#][^:/?#]*(?:[/?#]|$))/;

const FETCHABLE_REFERENCE_MESSAGE =
  "Must be an absolute URL (https://example.com/data.geojson) or a path " +
  "to a file on your site (data/data.geojson, ./data.geojson or " +
  "/data/data.geojson). Relative paths resolve against the page, not the YAML file";

const ResourceURLSchema = z
  .string()
  .regex(FETCHABLE_REFERENCE, FETCHABLE_REFERENCE_MESSAGE);

/**
 * A tile URL template.
 *
 * @remarks
 * Tile templates additionally carry placeholders (`{z}/{x}/{y}`,
 * `{bbox-epsg-3857}`, `{ratio}`) whose braces are not legal URI characters, so
 * every standard XYZ template — including the ones in our own docs — fails a
 * literal URL check even though the parser accepts them. Validating with
 * placeholders substituted keeps the runtime check meaningful, against the
 * same rule every other source URL uses.
 */
const TileURLTemplateSchema = z
  .string()
  .refine(
    (value) => FETCHABLE_REFERENCE.test(value.replace(/\{[^}]+\}/g, "0")),
    {
      message:
        "Must be a tile URL or same-origin path, optionally with {z}/{x}/{y} placeholders",
    }
  )
  .describe("Tile URL template");

/**
 * The cloud-native file format a source reads (0.9, ml-cnv).
 *
 * @remarks
 * Optional: the URL normally says it — a `pmtiles://` scheme or a `.pmtiles`,
 * `.fgb`, `.parquet`, `.tif` extension. Write `format:` only for a URL with no
 * telling extension (a signed link, an API endpoint); it wins over the URL.
 * `type:` stays the MapLibre source type (`vector`/`raster`/`raster-dem` for
 * PMTiles or COG, `geojson` for FlatGeobuf and GeoParquet). All four are
 * read by this version. A source key in v1; under the source's
 * `runtime:` in a v2 document.
 *
 * @example
 * ```yaml
 * parcels:
 *   type: geojson
 *   url: https://data.example.org/api/parcels?f=fgb
 *   format: flatgeobuf
 * ```
 */
export const SourceFormatSchema = z
  .enum(["pmtiles", "flatgeobuf", "geoparquet", "cog"])
  .describe(
    "File format, when the URL doesn't show it (pmtiles, flatgeobuf, geoparquet, cog)"
  );

/**
 * Colours for a single-band Cloud Optimized GeoTIFF (0.9, ml-cnv.2).
 *
 * @remarks
 * A COG with one band of values (a vegetation index, a temperature) has no
 * colours of its own: `colorRamp:` maps `min`…`max` onto a palette — the
 * same names `classify:` uses (`viridis`, `YlGn`, `RdBu` …; default
 * `viridis`) — or onto your own `colors:`. Smooth by default; `classes: 5`
 * draws five flat classes instead. Only on a `type: raster` source whose
 * file is a COG. A source key in v1; under the source's `runtime:` in v2.
 *
 * @example
 * ```yaml
 * ndvi:
 *   type: raster
 *   url: data/ndvi.tif
 *   colorRamp: { palette: YlGn, min: 0, max: 0.9 }
 * ```
 */
export const ColorRampSchema = z
  .object({
    palette: z
      .string()
      .optional()
      .describe("Palette name, as in classify: (viridis, cividis, YlGn, RdBu …); default viridis"),
    colors: z
      .array(z.string())
      .min(2)
      .optional()
      .describe("Your own colours, low to high (#rrggbb), instead of a palette"),
    min: z.number().describe("The value drawn in the first colour"),
    max: z.number().describe("The value drawn in the last colour"),
    reverse: z.boolean().optional().describe("Run the colours high to low"),
    classes: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Draw this many flat classes instead of a smooth ramp (with colors:, spread along them)"),
  })
  .describe("COG: colours for a single band of values (palette or colors, min, max)");

/**
 * How a FlatGeobuf or GeoParquet source is read (0.9, ml-cnv.3/.4).
 *
 * @remarks
 * - `all` (default): the whole file, once. Works on any web server.
 * - `viewport`: only the features in view, re-read as the map moves; needs a
 *   server with range requests and a file that can be read in parts — a
 *   FlatGeobuf with a spatial index, or a GeoParquet file with a `bbox`
 *   covering column and spatially sorted row groups. Nothing is read below
 *   `minzoom` (default 10), nor for a view estimated to hold more than
 *   `maxFeatures` features (default 150,000): the map asks to zoom in.
 *
 * Without `load:` a file is read whole up to 400,000 features (and 50 MB
 * transferred, 100 MB decoded), and by view above that when it can be.
 * `maxFeatures` is the one override: it sets the per-view budget, and above
 * 400,000 it also raises the whole-file limit (heavier on memory).
 *
 * `overviews` (experimental, 0.10): a GeoParquet file with `geo:overviews`
 * levels, read by view, draws the level that fits the zoom; `false` reads
 * only its full-detail level, as 0.9.2 does.
 *
 * @example
 * ```yaml
 * load: { mode: viewport, minzoom: 12, maxFeatures: 50000 }
 * load: { maxFeatures: 600000 }   # load a 550,000-feature file whole
 * load: { mode: viewport, overviews: false }
 * ```
 */
export const SourceLoadSchema = z
  .union([
    z.enum(["all", "viewport"]),
    z.object({
      mode: z
        .enum(["all", "viewport"])
        .optional()
        .describe("all (whole file, the default) or viewport (features in view)"),
      minzoom: z
        .number()
        .min(0)
        .max(24)
        .optional()
        .describe("viewport: read nothing below this zoom (default 10)"),
      maxFeatures: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "The most features one read takes: a view holding more isn't read (default 150000; the map asks to zoom in), and above 400000 it also raises the whole-file limit (heavier on memory)"
        ),
      overviews: z
        .boolean()
        .optional()
        .describe(
          "Experimental. GeoParquet overview files (geo:overviews) read by view: draw the level that fits the zoom (true, the default) or only the full-detail level (false)"
        ),
    }),
  ])
  .describe(
    "FlatGeobuf/GeoParquet: read the whole file (all, default) or only the features in view (viewport)"
  );

/**
 * The GeoParquet columns to read (0.9, ml-cnv.4).
 *
 * @remarks
 * By default only the columns the document references for the source
 * (paint, layout, filters, popups, `classify:` …) are read, plus the
 * geometry. A list replaces that inference; `all` reads every column — for
 * page JavaScript that reads clicked features' other properties.
 *
 * @example
 * ```yaml
 * columns: [name, depth_m]
 * ```
 */
export const SourceColumnsSchema = z
  .union([z.literal("all"), z.array(z.string()).min(1)])
  .describe("GeoParquet: the columns to read (default: the ones this document references), or all");

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
  url: ResourceURLSchema.optional().describe("WebSocket or SSE endpoint URL"),
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
 * Appended to the "needs url, data or prefetchedData" error when the source
 * has a `stream:` (ml-aot.134): a stream adds to data the source already
 * has, so a stream-only source is refused, and this says how to start empty.
 *
 * @internal
 */
export const STREAM_START_HINT =
  " A stream: adds to the source's data, so it needs somewhere to start: to start empty " +
  "until the first message arrives, add data: { type: FeatureCollection, features: [] }.";

/**
 * A source's `loading:` block.
 *
 * @deprecated Has no effect: no per-source loading overlay is drawn
 * (ml-aot.132). Still accepted, with a deprecation warning. While a map
 * starts, `<ml-map>` shows its own "Loading map…" and sets `aria-busy`, and a
 * data file that fails to load is reported in the notice on the map.
 */
export const LoadingConfigSchema = z
  .object({
    enabled: z.boolean().default(false).describe("No effect (deprecated)"),
    message: z.string().optional().describe("No effect (deprecated)"),
    showErrorOverlay: z.boolean().default(true).describe("No effect (deprecated)"),
  })
  .describe(
    'Deprecated, no effect: no per-source loading overlay is drawn. The map shows "Loading map…" while it starts'
  );

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
    fetchStrategy: z
      .enum(["runtime", "build", "hybrid"])
      .default("runtime")
      .describe(
        "No effect (deprecated): data is always fetched in the browser when the map loads. build and hybrid warn and do nothing"
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
  RasterDEMSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
]);

/** Inferred type for any layer source. */
export type LayerSource = z.infer<typeof LayerSourceSchema>;

// Source schemas are intentional MapLibre passthrough objects (`.passthrough()`):
// they accept arbitrary valid source options (maxzoom, minzoom, cluster,
// clusterRadius, buffer, tolerance, promoteId, attribution, ...). Exempt them
// from unknown-key warnings so valid-but-unlisted options are not flagged.
// (Authored styling objects — layers/paint/layout — are deliberately NOT
// exempt so paint-key typos like `circle-radis` keep being caught.)
markOpenSchema(GeoJSONSourceSchema);
markOpenSchema(VectorSourceSchema);
markOpenSchema(RasterSourceSchema);
markOpenSchema(RasterDEMSourceSchema);
markOpenSchema(ImageSourceSchema);
markOpenSchema(VideoSourceSchema);
