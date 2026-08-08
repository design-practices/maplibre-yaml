/**
 * @file Format-v2 map block schema for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/map-v2
 *
 * @description
 * Zod schema for the format-v2 document shape — the `style:`/`runtime:` split
 * defined in the format-v2 plan. This unit (U2) is **validation only**: a
 * `version: 2` document validates against {@link MapBlockV2Schema} and parses
 * to a raw v2 block. Turning that block into a {@link MapModel} is U3's job.
 *
 * ## The compose-vs-author split
 *
 * The spec bodies are **reused, not re-authored** — a layer's paint/layout/type
 * and a source's spec fields are byte-identical to v1. What is authored fresh is
 * the *envelope* and the *runtime nesting*:
 *
 * - `style:` lifts the camera keys (`center`/`zoom`/`pitch`/`bearing`) and
 *   `basemap` (v1's `mapStyle`) to its root, and carries `state`, `sources`,
 *   and `layers`.
 * - Each **source** keeps its v1 spec body but moves its live-data keys
 *   (`refresh`/`stream`/`cache`/`loading`) under a nested `runtime:` — in v1
 *   these were inline on the source.
 * - Each **layer** keeps its v1 spec body but moves `interactive`/`legend`/
 *   `label`/`toggleable` under a nested `runtime:`, and reserves an
 *   accepted-but-unread `extends:` key (KTD3 / V2-D6).
 * - `runtime:` carries `map` (MapLibre `Map` constructor options), `controls`,
 *   `legend`, `parameters`, and `container`.
 *
 * ## Unknown-key warnings
 *
 * The v2 envelope objects (`style`, the v2 source, the v2 layer) are
 * `.passthrough()` but deliberately **not** registered via {@link markOpenSchema}
 * — exactly like v1's authored styling objects (layers/paint). So a v1-spelling
 * mistake under v2 — `mapStyle` at the style root, a top-level `refresh` on a
 * source — surfaces as an unknown-key warning rather than a silent pass, while
 * still parsing. `runtime.map` *is* marked open, because it is an intentional
 * MapLibre `MapOptions` passthrough (mirroring v1's `config:`).
 */

import { z } from "zod";
import {
  MapConfigSchema,
  ControlsConfigSchema,
  LegendConfigSchema,
  StateSchema,
  ParametersSchema,
} from "./map.schema";
import {
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  RasterDEMSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
  RefreshConfigSchema,
  StreamConfigSchema,
  CacheConfigSchema,
  LoadingConfigSchema,
} from "./source.schema";
import {
  CircleLayerSchema,
  LineLayerSchema,
  FillLayerSchema,
  SymbolLayerSchema,
  RasterLayerSchema,
  FillExtrusionLayerSchema,
  HeatmapLayerSchema,
  HillshadeLayerSchema,
  BackgroundLayerSchema,
  InteractiveConfigSchema,
  LegendItemSchema,
} from "./layer.schema";
import { GeoJSONSchema } from "./geojson.schema";
import { SOURCE_RUNTIME_KEYS } from "../model/normalize";
import { markOpenSchema } from "../parser/validation-utils";

/**
 * Peel a source/layer schema down to its underlying `ZodObject`.
 *
 * @remarks
 * Several v1 source schemas are wrapped in `.superRefine()`/`.refine()`
 * (a `ZodEffects`) for cross-field rules — e.g. the geojson url/data guard or
 * the vector url/tiles requirement. Composing the v2 shape needs the object
 * itself so its shape can be reused with `.omit()`/`.extend()`. The refine is
 * intentionally dropped: v2 nests the live-data keys the guards reference under
 * `source.runtime`, and this unit validates shape rather than re-deriving those
 * cross-field rules.
 */
function baseObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> {
  let s: unknown = schema;
  while ((s as { _def?: { typeName?: string } })?._def?.typeName === "ZodEffects") {
    s = (s as { _def: { schema: unknown } })._def.schema;
  }
  return s as z.ZodObject<z.ZodRawShape>;
}

/** `.omit()` mask over the source runtime keys (v1-inline → v2 `source.runtime`). */
const SOURCE_RUNTIME_OMIT = Object.fromEntries(
  SOURCE_RUNTIME_KEYS.map((k) => [k, true as const])
) as Record<(typeof SOURCE_RUNTIME_KEYS)[number], true>;

/**
 * Per-source `runtime:` — the live-data configuration.
 *
 * @remarks
 * In v1 these keys are inline on the source object; v2 nests them here, beside
 * the source they act on. The config sub-shapes are reused from
 * `source.schema.ts` verbatim.
 */
export const SourceRuntimeSchema = z
  .object({
    refresh: RefreshConfigSchema.optional().describe(
      "Polling refresh configuration"
    ),
    stream: StreamConfigSchema.optional().describe(
      "WebSocket/SSE streaming configuration"
    ),
    cache: CacheConfigSchema.optional().describe("Cache configuration"),
    loading: LoadingConfigSchema.optional().describe(
      "Loading UI configuration"
    ),
    prefetchedData: z
      .any()
      .optional()
      .describe("Pre-fetched data from build time"),
    fetchStrategy: z
      .enum(["runtime", "build", "hybrid"])
      .optional()
      .describe("When to fetch data: runtime (default), build, or hybrid"),
  })
  .passthrough()
  .describe("Per-source live-data configuration (v2 `source.runtime`)");

/** The unwrapped geojson object, reused for both its spec body and runtime. */
const geojsonBaseObject = baseObject(GeoJSONSourceSchema);

/**
 * The geojson v2 source runtime — {@link SourceRuntimeSchema} plus a
 * defaulting `fetchStrategy`.
 *
 * @remarks
 * v1's geojson source materializes `fetchStrategy: "runtime"` (its `.default`)
 * on *every* source, and `normalizeSource` partitions that into
 * `source.runtime`. The v2 geojson spec body omits `fetchStrategy`
 * ({@link SOURCE_RUNTIME_OMIT}) so it never leaks into the emitted `style.json`;
 * to keep AE2 exact the field is re-introduced *here*, composed from the same v1
 * definition so it carries the same default. Combined with the defaulted runtime
 * below, a v2 geojson source normalizes to the identical model as its v1 twin —
 * even when it omits `runtime:` entirely. `fetchStrategy` is geojson-specific in
 * v1 (no other source type defaults a runtime key), so only this variant
 * materializes it.
 */
export const GeoJSONSourceRuntimeSchema = SourceRuntimeSchema.extend({
  // Reuse the exact v1 field definition (carries `.default("runtime")`). The
  // `.shape` index is typed `ZodTypeAny | undefined`; the key is known-present.
  fetchStrategy: geojsonBaseObject.shape.fetchStrategy as z.ZodTypeAny,
  // U4: `prefetchedData` is inline GeoJSON, moved under `source.runtime` in v2.
  // Validate it with the strict RFC 7946 schema (hard error under v2), the same
  // treatment `source.data` gets in the spec body below. v1 leaves both z.any().
  prefetchedData: GeoJSONSchema.optional().describe(
    "Pre-fetched inline GeoJSON from build time"
  ),
})
  .passthrough()
  .describe("Per-source live-data configuration (v2 geojson `source.runtime`)");

/**
 * Attach the v2 `runtime:` key to a reused source spec object.
 *
 * @param materialize - when true the runtime `.default({})`s so a source that
 *   omits `runtime:` still fires the runtime's own field defaults (geojson's
 *   `fetchStrategy`); otherwise the runtime is simply optional.
 */
function withSourceRuntime(
  spec: z.ZodObject<z.ZodRawShape>,
  runtimeSchema: z.ZodTypeAny = SourceRuntimeSchema,
  materialize = false
): z.ZodTypeAny {
  return spec
    .extend({
      runtime: (materialize
        ? runtimeSchema.default({})
        : runtimeSchema.optional()
      ).describe("Per-source live-data configuration"),
    })
    .passthrough();
}

/**
 * Re-apply the "url or tiles" cross-field guard to a composed v2 tile source.
 *
 * @remarks
 * {@link baseObject} peels the v1 source schema's `ZodEffects` wrapper to reuse
 * its shape, discarding the cross-field `.refine()`. For vector/raster/raster-dem
 * the referenced keys (`url`/`tiles`) survive verbatim into the v2 spec body, so
 * the guard is still applicable and is re-applied here — otherwise a v2 tile
 * source with neither would validate where its v1 twin is rejected, failing
 * later with a worse message.
 */
function requireUrlOrTiles(
  schema: z.ZodTypeAny,
  label: string
): z.ZodTypeAny {
  return schema.refine(
    (d) => {
      const o = d as Record<string, unknown>;
      return Boolean(o["url"] || o["tiles"]);
    },
    {
      message:
        `${label} source requires either "url" (TileJSON) or "tiles" (tile URL array). ` +
        "Provide at least one of these properties.",
    }
  );
}

/**
 * A v2 source: the v1 spec body plus an optional nested `runtime:`.
 *
 * @remarks
 * Only the geojson source carried live-data keys inline in v1, so it is the one
 * whose spec body is trimmed with {@link SOURCE_RUNTIME_OMIT} before the
 * `runtime:` key is attached. The others carry no live-data keys and are reused
 * as-is. None of these objects are marked open, so a live-data key left in the
 * v1 position (`source.refresh`) surfaces as an unknown-key warning.
 *
 * The v1 source schemas carried cross-field guards in a `ZodEffects` wrapper
 * that {@link baseObject} peels off. The guards whose referenced keys survive
 * into the v2 spec are re-applied here so a v2 source is not accepted where its
 * v1 twin is rejected: geojson's "at least one data source" (now checking
 * `url`/`data`/`runtime.prefetchedData`, since `prefetchedData` moved under
 * `runtime:` in v2) and the tile sources' "url or tiles".
 */
export const SourceV2Schema: z.ZodTypeAny = z.union([
  withSourceRuntime(
    // U4: override the v1 `data: z.any()` with the strict RFC 7946 schema, so a
    // malformed inline geometry is a HARD ERROR under v2. v1's `source.data`
    // stays `z.any()` (source.schema.ts) — the byte-for-byte compat guarantee.
    geojsonBaseObject.omit(SOURCE_RUNTIME_OMIT).extend({
      data: GeoJSONSchema.optional().describe("Inline GeoJSON object"),
    }),
    GeoJSONSourceRuntimeSchema,
    true
  ).superRefine((d, ctx) => {
    // v1's geojson guard: at least one data source. `prefetchedData` moved under
    // `runtime:` in v2, so check there; `url`/`data` remain in the spec body.
    const o = d as Record<string, unknown>;
    const runtime = o["runtime"] as Record<string, unknown> | undefined;
    if (
      !o["url"] &&
      o["data"] === undefined &&
      (runtime === undefined || runtime["prefetchedData"] === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "GeoJSON source requires at least one of: url, data, or runtime.prefetchedData. " +
          'Use "url" to fetch from an endpoint, "data" for inline GeoJSON, ' +
          'or "runtime.prefetchedData" for build-time fetched data.',
      });
    }
  }),
  requireUrlOrTiles(withSourceRuntime(baseObject(VectorSourceSchema)), "Vector"),
  requireUrlOrTiles(withSourceRuntime(baseObject(RasterSourceSchema)), "Raster"),
  requireUrlOrTiles(
    withSourceRuntime(baseObject(RasterDEMSourceSchema)),
    "Raster DEM"
  ),
  withSourceRuntime(baseObject(ImageSourceSchema)),
  withSourceRuntime(baseObject(VideoSourceSchema)),
]);

/**
 * Per-layer `runtime:` — interactions, legend entry, label, toggle state.
 *
 * @remarks
 * In v1 these sit inline on the layer; v2 nests them here. The sub-shapes are
 * reused from `layer.schema.ts` verbatim.
 */
export const LayerRuntimeSchema = z
  .object({
    interactive: InteractiveConfigSchema.describe(
      "Interactive event configuration"
    ),
    legend: LegendItemSchema.optional().describe("Legend entry for this layer"),
    label: z.string().optional().describe("Human-readable layer label"),
    toggleable: z
      .boolean()
      .optional()
      .describe("Allow users to toggle visibility"),
  })
  .passthrough()
  .describe("Per-layer experience configuration (v2 `layer.runtime`)");

/**
 * The extension attached to every v2 layer: a nested `runtime:`, the
 * reserved-but-unread `extends:` key (V2-D6 / KTD3), and a v2-shaped `source:`
 * override.
 *
 * @remarks
 * The v1 layer bodies validate `source:` with the v1 {@link LayerSourceSchema}
 * (via `BaseLayerPropertiesSchema`), which for an inline geojson source
 * materializes `fetchStrategy: "runtime"` **flat** on the source object rather
 * than under a nested `runtime:`. Left alone, that flat key rides into
 * `spec.source` (the erasable half) and diverges from the v1 twin, which
 * partitions it into `runtime.source` — breaking AE2 and leaking a key
 * MapLibre's validator rejects into the emitted style. Overriding `source:`
 * here with the v2 source shape (nested `runtime:`, strict RFC 7946 `data`)
 * makes an inline layer source carry its live-data under `runtime:` exactly as
 * top-level `style.sources` do, so {@link readV2Source}'s nested-`runtime:` peel
 * is correct and AE2 holds. The string-reference option is preserved; `source:`
 * is optional so background layers (which carry none) stay valid.
 */
const layerV2Extension = {
  runtime: LayerRuntimeSchema.optional().describe(
    "Per-layer experience configuration"
  ),
  extends: z
    .unknown()
    .optional()
    .describe(
      "Reserved — layer inheritance (v2). The key name is claimed; the " +
        "semantics are not defined and the value is unread."
    ),
  source: z
    .union([z.string(), SourceV2Schema])
    .optional()
    .describe(
      "Layer source: a named-source string ref, or an inline v2 source " +
        "(nested `runtime:`, strict RFC 7946 `data`)"
    ),
} as const;

/**
 * A v2 layer: the v1 spec body plus the {@link layerV2Extension} keys.
 *
 * @remarks
 * The v1 layer bodies are reused verbatim (paint/layout/type/source/filter are
 * identical to v1) and merely `.extend()`ed with the v2 nesting. Discriminated
 * on `type`, as v1 is. `$ref` layer references are not carried: v2 relies on
 * YAML-native anchors, resolved at parse.
 */
export const LayerV2Schema: z.ZodTypeAny = z.discriminatedUnion("type", [
  CircleLayerSchema.extend(layerV2Extension),
  LineLayerSchema.extend(layerV2Extension),
  FillLayerSchema.extend(layerV2Extension),
  SymbolLayerSchema.extend(layerV2Extension),
  RasterLayerSchema.extend(layerV2Extension),
  FillExtrusionLayerSchema.extend(layerV2Extension),
  HeatmapLayerSchema.extend(layerV2Extension),
  HillshadeLayerSchema.extend(layerV2Extension),
  BackgroundLayerSchema.extend(layerV2Extension),
]);

/**
 * The `style:` half — everything that contributes to the compiled `style.json`.
 *
 * @remarks
 * The camera keys and `basemap` are lifted to the root (their field *types* are
 * reused from {@link MapConfigSchema}; `basemap` is v1's `mapStyle`). Not marked
 * open, so `mapStyle` at this root — the v1 spelling — warns rather than passing
 * silently.
 */
export const StyleV2Schema: z.ZodTypeAny = z
  .object({
    basemap: MapConfigSchema.shape.mapStyle.describe(
      "Base style URL or inline style object (v2 rename of v1 `mapStyle`)"
    ),
    center: MapConfigSchema.shape.center
      .optional()
      .describe("Map center [longitude, latitude]"),
    zoom: MapConfigSchema.shape.zoom.optional().describe("Zoom level (0-24)"),
    pitch: MapConfigSchema.shape.pitch.describe("Camera pitch angle (0-85)"),
    bearing: MapConfigSchema.shape.bearing.describe("Camera bearing (-180-180)"),
    metadata: z
      .record(z.any())
      .optional()
      .describe("Style metadata (style-spec root `metadata` slot)"),
    state: StateSchema.optional().describe(
      "Spec-native runtime-tunable values, read via `global-state`"
    ),
    sources: z
      .record(z.string(), SourceV2Schema)
      .optional()
      .describe("Map sources, each with an optional nested `runtime:`"),
    layers: z
      .array(LayerV2Schema)
      .default([])
      .describe("Map layers, each with an optional nested `runtime:`"),
  })
  .passthrough()
  .describe("The style half — everything that erases to `style.json`");

/**
 * A passthrough record of MapLibre `Map` constructor options.
 *
 * @remarks
 * `interactive` is composed from the **same** {@link MapConfigSchema} field v1
 * uses, so it carries v1's `.default(true)`. This is the AE2 linchpin: v1's
 * `config.interactive` always materializes into `runtime.map.interactive: true`,
 * so the v2 `runtime.map` must too — otherwise a minimal v1 doc and its v2 twin
 * diverge on exactly this key. The default fires even when the document omits
 * `runtime:` entirely, because `runtime` and `runtime.map` default to `{}` up
 * the chain (see {@link RuntimeV2Schema} and {@link MapBlockV2Schema}).
 */
export const RuntimeMapSchema = z
  .object({
    interactive: MapConfigSchema.shape.interactive,
  })
  .passthrough()
  .describe("MapLibre `Map` constructor options (minZoom, scrollZoom, ...)");

// `runtime.map` is an intentional MapLibre `MapOptions` passthrough, mirroring
// v1's `config:` block — exempt it from unknown-key warnings.
markOpenSchema(RuntimeMapSchema);

/**
 * The `runtime:` half — everything that degrades. Nothing here reaches the
 * compiled style.
 */
export const RuntimeV2Schema: z.ZodTypeAny = z
  .object({
    // `.default({})` so the `interactive` default inside RuntimeMapSchema fires
    // even when a document writes `runtime:` without a `map:` block.
    map: RuntimeMapSchema.default({}).describe(
      "MapLibre `Map` constructor options"
    ),
    controls: ControlsConfigSchema.optional().describe("Map controls"),
    legend: LegendConfigSchema.optional().describe("Legend configuration"),
    parameters: ParametersSchema.optional().describe(
      "Presentation metadata for `state` keys — label, type, range"
    ),
    container: z
      .object({
        style: z
          .string()
          .optional()
          .describe("Inline CSS styles for the map container"),
        className: z
          .string()
          .optional()
          .describe("CSS class name for the map container"),
      })
      .passthrough()
      .optional()
      .describe("Map container presentation (v2 home of v1's `style:`/`className:`)"),
  })
  .passthrough()
  .describe("The runtime half — everything that degrades");

/**
 * Format-v2 map block.
 *
 * @remarks
 * The top-level envelope: `version: 2`, `type: map`, `id`, the `style:` and
 * `runtime:` halves, and the document-root `state`/`parameters` positions.
 * `.passthrough()` keeps the `x-*` extension escape hatch — `x-*` keys are
 * retained and never produce unknown-key warnings, exactly as v1.
 *
 * The type is annotated `z.ZodObject<any>` deliberately: the fully-inferred type
 * of the composed schema (a discriminated union of nine extended layer bodies
 * inside a record inside the envelope) overflows TypeScript's serialization
 * buffer (TS7056), the same reason {@link MapBlockSchema} carries the same
 * annotation.
 */
export const MapBlockV2Schema: z.ZodObject<any> = z
  .object({
    version: z.literal(2).describe("Format version — v2 documents state `version: 2`"),
    type: z.literal("map").describe("Block type"),
    id: z.string().describe("Unique block identifier"),
    style: StyleV2Schema,
    // `.default({})` so a document that omits `runtime:` still normalizes to the
    // same model as its v1 twin — `runtime.map.interactive: true` fires up the
    // default chain (RuntimeV2Schema.map → RuntimeMapSchema.interactive).
    runtime: RuntimeV2Schema.default({}).describe("The runtime half"),
    state: StateSchema.optional().describe(
      "Runtime-tunable values (may live here or under `style:`)"
    ),
    parameters: ParametersSchema.optional().describe(
      "Presentation metadata for `state` keys (may live here or under `runtime:`)"
    ),
  })
  .passthrough()
  .describe("Format-v2 map block");

/** Inferred type for a format-v2 map block. */
export type MapBlockV2 = z.infer<typeof MapBlockV2Schema>;
