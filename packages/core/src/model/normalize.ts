/**
 * @file v1 surface syntax → the v2 internal model
 * @module @maplibre-yaml/core/model
 *
 * @description
 * Normalization is where the erasability boundary is applied. Everything
 * downstream — the renderer today, the emitter next — sees the split already
 * made, so neither has to carry its own opinion about which keys survive
 * compilation.
 *
 * Two invariants govern the whole file:
 *
 * 1. **Never invent a key.** MapLibre merges constructor options over its own
 *    defaults, so `{ attributionControl: undefined }` is not equivalent to
 *    `{}` — it overwrites the default and the map ends up with no attribution
 *    at all. Splitting a block by reading each known key and reassembling would
 *    reintroduce exactly that, which is why the split below partitions the
 *    author's own keys rather than enumerating ours.
 * 2. **Never drop a key.** An unrecognized key goes to the style side, where
 *    the schemas are `.passthrough()` and MapLibre may well understand it. The
 *    runtime side is a closed list because it is *ours* — we know every key
 *    that drives our machinery, and anything else belongs to the spec.
 */

import type { MapConfig, ControlsConfig, LegendConfig } from "../schemas";
import type { Layer } from "../schemas/layer.schema";
import type { LayerSource } from "../schemas/source.schema";
import type { MapModel, LayerModel, SourceModel, V1MapInput } from "./types";

/**
 * `config:` keys that erase into the style-spec root.
 *
 * @remarks
 * Everything else in `config:` is a `Map` constructor option with no style-spec
 * equivalent. `mapStyle` is handled separately because it is also renamed.
 */
const CAMERA_KEYS = ["center", "zoom", "pitch", "bearing"] as const;

/**
 * Source keys that drive our machinery rather than MapLibre's.
 *
 * @remarks
 * This is the 0.4.0 named-source scrub list, promoted from an inline
 * destructure to a declared boundary. It is closed by construction: these are
 * the keys *we* invented, so anything not on it is spec surface.
 */
const SOURCE_RUNTIME_KEYS = [
  "refresh",
  "stream",
  "cache",
  "loading",
  "prefetchedData",
  "fetchStrategy",
  // Legacy top-level refresh fields, deprecated but still honored.
  "refreshInterval",
  "updateStrategy",
  "updateKey",
] as const;

/**
 * Layer keys that describe the experience rather than the cartography.
 *
 * @remarks
 * `visible` is deliberately absent: it erases to `layout.visibility`, so it is
 * style surface even though it reads like chrome. `toggleable` is runtime
 * because nothing in the style spec can express "the user may turn this off".
 */
const LAYER_RUNTIME_KEYS = [
  "interactive",
  "legend",
  "label",
  "toggleable",
  "metadata",
] as const;

/** Partition an object's own keys, preserving presence exactly. */
function partition(
  source: Record<string, unknown> | undefined,
  runtimeKeys: readonly string[]
): { spec: Record<string, unknown>; runtime: Record<string, unknown> } {
  const spec: Record<string, unknown> = {};
  const runtime: Record<string, unknown> = {};
  if (!source) return { spec, runtime };

  // Iterating the author's keys rather than ours is what keeps presence
  // faithful — a key the author omitted is absent from both halves rather
  // than present-and-undefined in one.
  for (const key of Object.keys(source)) {
    if (runtimeKeys.includes(key)) {
      runtime[key] = source[key];
    } else {
      spec[key] = source[key];
    }
  }
  return { spec, runtime };
}

/** Normalize one source. */
export function normalizeSource(source: LayerSource): SourceModel {
  return partition(source as Record<string, unknown>, SOURCE_RUNTIME_KEYS);
}

/** Normalize one layer. */
export function normalizeLayer(layer: Layer): LayerModel {
  return partition(layer as unknown as Record<string, unknown>, LAYER_RUNTIME_KEYS);
}

/**
 * Normalize a v1 map document into the internal model.
 *
 * @remarks
 * The `config:` block is the one that has to be cut rather than moved: it is
 * declared as a single MapLibre `MapOptions` passthrough, but `center`, `zoom`,
 * `pitch`, `bearing`, and `mapStyle` are style-spec root properties while the
 * rest are constructor-only. Any split that keeps `config:` whole on one side
 * contradicts the spec.
 *
 * `state` and `parameters` are accepted here ahead of the rest of v2's surface
 * syntax. `state` is a style-spec root property, so accepting it is additive
 * and breaks nothing — and without it no authored document could exercise R13
 * or AE6 until v0.6.0. This is the only v2 key v0.5.0 accepts, deliberately.
 */
export function normalizeMapBlock(input: V1MapInput): MapModel {
  const config = (input.config ?? {}) as Record<string, unknown>;

  const camera: Record<string, unknown> = {};
  const runtimeMap: Record<string, unknown> = {};

  for (const key of Object.keys(config)) {
    if ((CAMERA_KEYS as readonly string[]).includes(key)) {
      camera[key] = config[key];
    } else if (key === "mapStyle" || key === "state" || key === "parameters") {
      // Handled below — hoisted out of `config:` rather than routed within it.
    } else {
      runtimeMap[key] = config[key];
    }
  }

  const sources: Record<string, SourceModel> = {};
  for (const [name, source] of Object.entries(input.sources ?? {})) {
    sources[name] = normalizeSource(source);
  }

  const model: MapModel = {
    id: input.id,
    style: {
      camera: camera as unknown as MapModel["style"]["camera"],
      sources,
      layers: (input.layers ?? []).map(normalizeLayer),
    },
    runtime: {
      map: runtimeMap,
    },
  };

  // Optional keys are attached only when present, never as `undefined` — the
  // model carries the same presence discipline it enforces on `runtime.map`.
  if ("mapStyle" in config) model.style.basemap = config["mapStyle"] as MapConfig["mapStyle"];
  if ("state" in config) model.style.state = config["state"] as Record<string, unknown>;
  if ("parameters" in config)
    model.runtime.parameters = config["parameters"] as Record<string, unknown>;
  if (input.controls !== undefined) model.runtime.controls = input.controls;
  if (input.legend !== undefined) model.runtime.legend = input.legend;
  if (input.className !== undefined || input.style !== undefined) {
    model.runtime.container = {};
    if (input.className !== undefined) model.runtime.container.className = input.className;
    if (input.style !== undefined) model.runtime.container.style = input.style;
  }

  return model;
}

/**
 * Reassemble the v1 `config:` object the renderer's managers still consume.
 *
 * @remarks
 * The round trip is the fidelity proof. v0.5.0 makes the model canonical at the
 * renderer's boundary without rewriting every manager onto new shapes — the
 * managers keep their interfaces, and normalize-then-denormalize being
 * invisible to the existing renderer suites is what demonstrates the model
 * loses nothing. The emitter (U4) reads the model directly and never round
 * trips; migrating the managers is later work, not a precondition for it.
 *
 * Key presence is reconstructed exactly, including `mapStyle`, which is why
 * this cannot be a spread of defaults.
 */
export function denormalizeConfig(model: MapModel): MapConfig {
  const config: Record<string, unknown> = {
    ...model.runtime.map,
    ...model.style.camera,
  };
  if (model.style.basemap !== undefined) config["mapStyle"] = model.style.basemap;
  if (model.style.state !== undefined) config["state"] = model.style.state;
  if (model.runtime.parameters !== undefined) config["parameters"] = model.runtime.parameters;
  return config as unknown as MapConfig;
}

/** Reassemble the v1 layer array. */
export function denormalizeLayers(model: MapModel): Layer[] {
  return model.style.layers.map(
    (layer) => ({ ...layer.spec, ...layer.runtime }) as unknown as Layer
  );
}

/** Reassemble the v1 named-source record. */
export function denormalizeSources(model: MapModel): Record<string, LayerSource> {
  const sources: Record<string, LayerSource> = {};
  for (const [name, source] of Object.entries(model.style.sources)) {
    sources[name] = { ...source.spec, ...source.runtime } as unknown as LayerSource;
  }
  return sources;
}

/** Reassemble the renderer options carried outside `config:`. */
export function denormalizeOptions(model: MapModel): {
  controls?: ControlsConfig;
  legend?: LegendConfig;
} {
  const options: { controls?: ControlsConfig; legend?: LegendConfig } = {};
  if (model.runtime.controls !== undefined) options.controls = model.runtime.controls;
  if (model.runtime.legend !== undefined) options.legend = model.runtime.legend;
  return options;
}
