/**
 * @file Format-v2 surface syntax → the internal model.
 * @module @maplibre-yaml/core/model/read-v2
 *
 * @description
 * The v2 front end. Where {@link normalizeMapBlock} *cuts* a flat v1 block into
 * the style/runtime halves, this reader mostly *lifts* — a v2 document already
 * carries the split the author made explicit (`style:`/`runtime:`, per-source
 * and per-layer `runtime:`), so the reader's job is structural rearrangement
 * into the {@link MapModel} shape rather than partitioning.
 *
 * The binding contract is AE2: a v1 document and its v2 equivalent must produce
 * **deep-equal** models. That means this reader must reproduce
 * `normalizeMapBlock`'s output *exactly*, including the defaults v1's schemas
 * materialize — `runtime.map.interactive: true` and a geojson source's
 * `runtime.fetchStrategy: "runtime"`. Those defaults are supplied by the v2
 * schema (map-v2.schema.ts), composed from the same field definitions v1 uses,
 * so this reader stays a pure rearrangement and never re-derives a v1 default.
 *
 * GeoJSON sugar (`location`/`region`/`route` → generated source/layer) is a
 * deferred follow-up: v1 does not expand it today, so matching the v1 model
 * means not expanding it here either. When it lands it belongs before this
 * reader, as a pre-pass on the parsed block.
 */

import type { MapConfig, ControlsConfig, LegendConfig } from "../schemas";
import type { MapModel, LayerModel, SourceModel } from "./types";
import type { MapBlockV2 } from "../schemas/map-v2.schema";
import { CAMERA_KEYS, LAYER_RUNTIME_KEYS, partition } from "./normalize";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read one v2 source into the model's `{ spec, runtime }` shape.
 *
 * @remarks
 * A v2 source nests its live-data keys under `runtime:`, which is already the
 * model's shape — so `spec` is the source without that key and `runtime` is the
 * nested block. This must land on the same partition {@link normalizeSource}
 * produces for the equivalent v1 source. A non-object source is passed through
 * untouched, exactly as `normalizeSource` does, so a malformed value the
 * renderer would skip is not turned into one MapLibre is asked to add.
 *
 * The `runtime` key is peeled with {@link partition} so the copy of the spec
 * half stays `__proto__`-safe, matching the v1 path.
 */
function readV2Source(source: unknown): SourceModel {
  if (!isPlainObject(source)) {
    return { spec: source as unknown as Record<string, unknown>, runtime: {} };
  }
  const { spec, runtime: peeled } = partition(source, ["runtime"]);
  const nested = peeled["runtime"];
  return { spec, runtime: isPlainObject(nested) ? nested : {} };
}

/**
 * Read one v2 layer into the model's `{ spec, runtime }` shape.
 *
 * @remarks
 * `extends:` is reserved and unread (KTD3 / V2-D6), so it never reaches the
 * model. `runtime:` is the author's nested runtime block.
 *
 * The reused v2 layer body still materializes the LAYER_RUNTIME_KEYS defaults
 * that v1 does — `toggleable: true` most notably — at the *top* of the layer,
 * where they would otherwise land in `spec`. So the body is partitioned by
 * LAYER_RUNTIME_KEYS exactly as {@link normalizeLayer} partitions a v1 layer,
 * and the author's nested `runtime:` is overlaid on top (an authored value wins
 * over a leaked default). This keeps AE2 exact and keeps those keys out of the
 * erasable `spec` half.
 *
 * The inline-source split also mirrors {@link normalizeLayer}: a source authored
 * inline on the layer carries its live-data under a nested `runtime:` (the v2
 * convention), which is lifted to `runtime.source` so `spec.source` stays clean.
 * That nesting is guaranteed by the schema — a v2 layer's `source:` is validated
 * by the v2 source shape (`layerV2Extension` in map-v2.schema.ts), so a geojson
 * inline source materializes `fetchStrategy` under `runtime:`, not flat on the
 * source; without that override the v1 layer schema would leave it flat and it
 * would leak into `spec.source`.
 */
function readV2Layer(layer: unknown): LayerModel {
  const { spec: body, runtime: peeled } = partition(
    layer as Record<string, unknown>,
    ["runtime", "extends"]
  );
  // Partition the body's own LAYER_RUNTIME_KEYS (e.g. the `toggleable` default)
  // out of the spec, then overlay the authored nested runtime.
  const { spec, runtime: fromBody } = partition(body, LAYER_RUNTIME_KEYS);
  const nested = peeled["runtime"];
  const runtime: Record<string, unknown> = {
    ...fromBody,
    ...(isPlainObject(nested) ? nested : {}),
  };

  const inlineSource = spec["source"];
  if (isPlainObject(inlineSource)) {
    const split = readV2Source(inlineSource);
    spec["source"] = split.spec;
    if (Object.keys(split.runtime).length > 0) {
      runtime["source"] = split.runtime;
    }
  }

  return { spec, runtime };
}

/**
 * Turn a validated format-v2 block into the internal {@link MapModel}.
 *
 * @param doc - a block already validated against `MapBlockV2Schema`.
 * @returns the internal model — deep-equal to the v1 twin's (AE2).
 */
export function readV2Block(doc: MapBlockV2): MapModel {
  const style = (doc.style ?? {}) as Record<string, unknown>;

  const camera: Record<string, unknown> = {};
  for (const key of Object.keys(style)) {
    if ((CAMERA_KEYS as readonly string[]).includes(key)) {
      camera[key] = style[key];
    }
  }

  const sources: Record<string, SourceModel> = {};
  const styleSources = (style["sources"] ?? {}) as Record<string, unknown>;
  for (const [name, src] of Object.entries(styleSources)) {
    sources[name] = readV2Source(src);
  }

  const layers = ((style["layers"] ?? []) as unknown[]).map(readV2Layer);

  const runtime = (doc.runtime ?? {}) as Record<string, unknown>;
  const runtimeMap = (runtime["map"] ?? {}) as Record<string, unknown>;

  const model: MapModel = {
    id: doc.id,
    style: {
      camera: camera as unknown as MapModel["style"]["camera"],
      sources,
      layers,
    },
    runtime: {
      map: runtimeMap,
    },
  };

  // TODO(v2 metadata): `style.metadata` (a v2 style-root slot) has no model
  // home yet and is not part of AE2 — leave it unhandled rather than guess one.

  // `state`/`parameters` may be authored under `style:`/`runtime:` OR at the
  // document root (MapBlockV2Schema accepts both positions). v1's
  // normalizeMapBlock reads them at the root, so a v2 doc that puts them there
  // must land in the same model slot — falling through to the root when the
  // nested position is absent keeps AE2 and honors never-drop. The nested
  // position wins when both are present.
  const docState = style["state"] ?? (doc as Record<string, unknown>)["state"];
  const docParameters =
    runtime["parameters"] ?? (doc as Record<string, unknown>)["parameters"];

  // Presence discipline: optional keys attach only when present, never as
  // `undefined` — the same rule normalizeMapBlock enforces.
  if ("basemap" in style)
    model.style.basemap = style["basemap"] as MapConfig["mapStyle"];
  if (docState !== undefined)
    model.style.state = docState as Record<string, unknown>;

  if (docParameters !== undefined)
    model.runtime.parameters = docParameters as Record<string, unknown>;
  if (runtime["controls"] !== undefined)
    model.runtime.controls = runtime["controls"] as ControlsConfig;
  if (runtime["legend"] !== undefined)
    model.runtime.legend = runtime["legend"] as LegendConfig;
  if (runtime["container"] !== undefined)
    model.runtime.container = runtime["container"] as {
      className?: string;
      style?: string;
    };

  return model;
}
