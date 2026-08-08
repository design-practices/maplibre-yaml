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

/** Attach the optional v2 `runtime:` key to a reused source spec object. */
function withSourceRuntime(
  spec: z.ZodObject<z.ZodRawShape>
): z.ZodTypeAny {
  return spec
    .extend({
      runtime: SourceRuntimeSchema.optional().describe(
        "Per-source live-data configuration"
      ),
    })
    .passthrough();
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
 */
export const SourceV2Schema: z.ZodTypeAny = z.union([
  withSourceRuntime(baseObject(GeoJSONSourceSchema).omit(SOURCE_RUNTIME_OMIT)),
  withSourceRuntime(baseObject(VectorSourceSchema)),
  withSourceRuntime(baseObject(RasterSourceSchema)),
  withSourceRuntime(baseObject(RasterDEMSourceSchema)),
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
 * The extension attached to every v2 layer: a nested `runtime:` plus the
 * reserved-but-unread `extends:` key (V2-D6 / KTD3).
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

/** A passthrough record of MapLibre `Map` constructor options. */
export const RuntimeMapSchema = z
  .object({})
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
    map: RuntimeMapSchema.optional().describe(
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
    runtime: RuntimeV2Schema.optional().describe("The runtime half"),
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
