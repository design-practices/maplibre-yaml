/**
 * @file Schemas every source type shares
 * @module @maplibre-yaml/core/schemas/sources/shared
 *
 * @description
 * The pieces the per-type source schemas (`./geojson`, `./vector`, …) compose:
 * the fetchable-reference URL schema and the tile URL template, the
 * cloud-native `format`/`load`/`columns`/`colorRamp` keys, and the runtime
 * `stream`/`loading`/`cache`/`refresh` blocks. Import them through
 * `../source.schema`, the stable path; this file exists so the per-type
 * files share one copy of each (the CDN bundle counts every byte).
 */

import { z } from "zod/v3";

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

export const ResourceURLSchema = z
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
export const TileURLTemplateSchema = z
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
