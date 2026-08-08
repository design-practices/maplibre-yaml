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
 * 2. **Never drop a key — fail open toward the spec.** An unrecognized key goes
 *    to the style side. The runtime side is a closed list because it is *ours*:
 *    we know every key that drives our machinery, so anything else is presumed
 *    to be MapLibre's. This is forward-compatibility rather than caution — the
 *    style spec gains keys on its own schedule, and a major MapLibre release
 *    will bring more, so a key we do not recognize today is more likely to be
 *    one the spec added than one nobody wants. The failure mode is a misplaced
 *    key rather than a lost one, and a typo of a runtime key still surfaces
 *    through the existing unknown-key warning at validation time.
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
 * Two absences are deliberate. `visible` erases to `layout.visibility`, so it
 * is style surface even though it reads like chrome. `metadata` is a legal
 * style-spec layer property that MapLibre carries through — authored metadata
 * reaching the emitted style is a *feature*, since downstream tools read it,
 * and Maputnik shows it. The consequence to document rather than prevent: a
 * `metadata` block rides into any redistributed artifact, so it is not a place
 * for annotations an author would not publish.
 *
 * `toggleable` is runtime because nothing in the style spec can express "the
 * user may turn this off".
 */
const LAYER_RUNTIME_KEYS = [
  "interactive",
  "legend",
  "label",
  "toggleable",
  // Not a style-spec layer property: the renderer passes it as the second
  // argument to `map.addLayer`, and the emitter honors it by ordering the
  // layers array. Leaving it on the style side would write a key MapLibre
  // ignores into the emitted style — and `validateStyleMin` accepts unknown
  // layer properties, so nothing downstream would catch it.
  "before",
] as const;

/** Partition an object's own keys, preserving presence exactly. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function partition(
  source: Record<string, unknown> | undefined,
  runtimeKeys: readonly string[]
): { spec: Record<string, unknown>; runtime: Record<string, unknown> } {
  // Null-prototype accumulators: a document key of `__proto__` would otherwise
  // assign through the prototype setter, reparenting the result and dropping
  // the key from both halves — silently violating the never-drop invariant on
  // exactly the input an attacker controls.
  const spec: Record<string, unknown> = Object.create(null);
  const runtime: Record<string, unknown> = Object.create(null);
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

/**
 * Normalize one source.
 *
 * @remarks
 * A non-object source is passed through untouched rather than partitioned. It
 * is malformed input, and manufacturing `{}` out of it would defeat the
 * renderer's own `typeof spec !== "object"` guard — turning a value the
 * renderer used to skip into one MapLibre is asked to add.
 */
export function normalizeSource(source: LayerSource): SourceModel {
  if (!isPlainObject(source)) {
    return { spec: source as unknown as Record<string, unknown>, runtime: {} };
  }
  return partition(source, SOURCE_RUNTIME_KEYS);
}

/**
 * Normalize one layer, including any source declared inline on it.
 *
 * @remarks
 * A layer may carry its source inline rather than by name, and that object
 * needs the same split as a named one — otherwise its live-data keys ride into
 * `layer.spec`, which is the half defined as compiling to `style.json`. That is
 * the leak the 0.4.0 named-source scrub existed to close, and it is not limited
 * to live-data documents: the geojson schema materializes `fetchStrategy` by
 * default on every source, so the emitted style would carry an unknown property
 * MapLibre's validator rejects for essentially any document.
 *
 * A string source is a named reference and stays as-is.
 */
export function normalizeLayer(layer: Layer): LayerModel {
  const model = partition(
    layer as unknown as Record<string, unknown>,
    LAYER_RUNTIME_KEYS
  );

  const inlineSource = model.spec["source"];
  if (isPlainObject(inlineSource)) {
    const split = partition(inlineSource, SOURCE_RUNTIME_KEYS);
    model.spec["source"] = split.spec;
    if (Object.keys(split.runtime).length > 0) {
      model.runtime["source"] = split.runtime;
    }
  }

  return model;
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
 * `state:` and `parameters:` are accepted at the document root ahead of the
 * rest of v2's surface syntax, which is where v2 puts them — so an author who
 * adopts them today writes them in their final position and has nothing to
 * migrate. `state` is a style-spec root property, so accepting it is additive
 * and breaks nothing, and without it no authored document could exercise R13
 * or AE6 until v0.6.0. These are the only v2 keys v0.5.0 accepts, deliberately.
 */
export function normalizeMapBlock(input: V1MapInput): MapModel {
  const config = (input.config ?? {}) as Record<string, unknown>;

  const camera: Record<string, unknown> = {};
  const runtimeMap: Record<string, unknown> = {};

  for (const key of Object.keys(config)) {
    if ((CAMERA_KEYS as readonly string[]).includes(key)) {
      camera[key] = config[key];
    } else if (key === "mapStyle") {
      // Handled below — hoisted out of `config:` and renamed.
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
  if (input.state !== undefined) model.style.state = input.state;
  if (input.parameters !== undefined) model.runtime.parameters = input.parameters;
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
  // `state` and `parameters` are deliberately absent. They are authored at the
  // document root, not inside `config:`, and nothing in v0.5.0's renderer
  // consumes them — they are carried in the model for the emitter. Reinjecting
  // them here would push unknown keys into MapLibre's constructor options.
  return config as unknown as MapConfig;
}

/**
 * Reassemble the v1 layer array.
 *
 * @remarks
 * The inline-source runtime half is merged back into the source object rather
 * than left as a sibling `runtime.source` key, so the reconstructed layer is
 * byte-for-byte what the author wrote.
 */
export function denormalizeLayers(model: MapModel): Layer[] {
  return model.style.layers.map((layer) => {
    const { source: sourceRuntime, ...runtime } = layer.runtime;
    const merged: Record<string, unknown> = { ...layer.spec, ...runtime };
    if (isPlainObject(sourceRuntime) && isPlainObject(merged["source"])) {
      merged["source"] = { ...merged["source"], ...sourceRuntime };
    }
    return merged as unknown as Layer;
  });
}

/** Reassemble the v1 named-source record. */
export function denormalizeSources(model: MapModel): Record<string, LayerSource> {
  const sources: Record<string, LayerSource> = {};
  for (const [name, source] of Object.entries(model.style.sources)) {
    if (!isPlainObject(source.spec)) {
      sources[name] = source.spec as unknown as LayerSource;
      continue;
    }
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
