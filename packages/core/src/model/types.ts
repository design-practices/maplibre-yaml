/**
 * @file The v2 internal model — one shape the renderer and the emitter share
 * @module @maplibre-yaml/core/model
 *
 * @description
 * Format v2 makes the erasability boundary visible in the document: everything
 * under `style:` contributes to the compiled `style.json`, and nothing under
 * `runtime:` does. This module is that boundary as a data structure.
 *
 * It exists a release before v2's surface syntax does, and that is deliberate.
 * The emitter is written only against this model (R30), so it never learns v1's
 * flat shape and then has to unlearn it when v2 parsing lands. v0.5.0 parses v1
 * and normalizes into the model; v0.6.0 adds a second front end that parses v2
 * directly into the same model. The half of the system downstream of the model
 * does not change when that happens.
 *
 * The split is *positional*, not a matter of key naming. `refresh` is runtime
 * because it drives our polling machinery and MapLibre has no idea what it is;
 * `promoteId` is style because it lands in the emitted source spec. The 0.4.0
 * named-source work discovered this boundary the hard way — it had to scrub
 * `refresh`, `cache`, and `prefetchedData` out of source objects before handing
 * them to MapLibre, because they were leaking into the spec MapLibre validates.
 * That scrub list is where the source-side split below comes from.
 */

import type { MapConfig, ControlsConfig, LegendConfig } from "../schemas";
import type { Layer } from "../schemas/layer.schema";
import type { LayerSource } from "../schemas/source.schema";

/**
 * Camera state, which the style spec carries at its root.
 *
 * @remarks
 * These are the only `config:` keys that erase. The rest of `config:` is
 * MapLibre `Map` constructor options with no style-spec equivalent, and lands
 * in {@link RuntimeHalf.map} instead — the split runs through the middle of
 * the block rather than around it.
 */
export interface CameraModel {
  center: MapConfig["center"];
  zoom: MapConfig["zoom"];
  pitch?: number;
  bearing?: number;
}

/**
 * A source, split into what MapLibre receives and what drives our own machinery.
 *
 * @remarks
 * `spec` is handed to `map.addSource` and, later, copied into the emitted
 * style. `runtime` holds the live-data configuration, which degrades to
 * snapshot-on-load when a document is compiled rather than rendered.
 */
export interface SourceModel {
  /** Keys MapLibre understands — the erasable half. */
  spec: Record<string, unknown>;
  /** Live-data configuration: refresh, stream, cache, loading, prefetch. */
  runtime: Record<string, unknown>;
}

/**
 * A layer, split the same way.
 *
 * @remarks
 * `runtime` carries the properties a cartographer thinks of as belonging to the
 * layer — its legend entry, its label, whether it can be toggled, what happens
 * on click — none of which the style spec can express. Keeping them beside the
 * layer rather than addressed by id from a separate block is decision V2-D1;
 * the emitter drops the whole `runtime` subtree by one rule at any depth.
 */
export interface LayerModel {
  /** Keys MapLibre understands, including `id`, `type`, `paint`, `filter`. */
  spec: Record<string, unknown>;
  /** Interactions, legend entry, label, toggle state, initial visibility. */
  runtime: Record<string, unknown>;
}

/** The half that compiles to `style.json`. */
export interface StyleHalf {
  /** The base style merged in at compile time. `mapStyle` in v1 surface syntax. */
  basemap?: MapConfig["mapStyle"];
  camera: CameraModel;
  /**
   * Spec-native runtime-tunable values (`state` root property).
   *
   * @remarks
   * Erases, because MapLibre carries it natively. The metadata a control UI
   * needs to render a picker for these — label, type, range — does not, and
   * lives in {@link RuntimeHalf.parameters}.
   */
  state?: Record<string, unknown>;
  /**
   * Style-spec root `metadata` (a v2 `style.metadata` slot).
   *
   * @remarks
   * The style spec carries a free-form `metadata` object at its root, so this
   * compiles through to the emitted `style.json` root rather than being dropped
   * — the never-drop discipline that governs the rest of the style half. It has
   * no v1 surface (v1 `config.metadata` is a `Map` option that lands in
   * {@link RuntimeHalf.map}), so it is absent from AE2 pairs and never causes a
   * v1/v2 divergence.
   */
  metadata?: Record<string, unknown>;
  sources: Record<string, SourceModel>;
  layers: LayerModel[];
}

/** The half that degrades. Nothing here reaches the compiled style. */
export interface RuntimeHalf {
  /**
   * MapLibre `Map` constructor options.
   *
   * @remarks
   * Key *presence* is significant here, not just value: MapLibre merges these
   * over its own defaults, so a key present with an `undefined` value is not
   * the same as an omitted one. Normalization must not invent keys the author
   * did not write.
   */
  map: Record<string, unknown>;
  controls?: ControlsConfig;
  legend?: LegendConfig;
  container?: { className?: string; style?: string };
  /** Presentation metadata for `state` keys, keyed by state name. */
  parameters?: Record<string, unknown>;
}

/** A whole map document, normalized. */
export interface MapModel {
  id: string;
  style: StyleHalf;
  runtime: RuntimeHalf;
}

/** The v1 surface shapes a normalizer consumes. */
export interface V1MapInput {
  id: string;
  config: MapConfig;
  layers?: Layer[];
  sources?: Record<string, LayerSource>;
  controls?: ControlsConfig;
  legend?: LegendConfig;
  className?: string;
  style?: string;
  /** Spec-native runtime tunables, authored at the document root as in v2. */
  state?: Record<string, unknown>;
  /** Presentation metadata for `state` keys — label, type, range. */
  parameters?: Record<string, unknown>;
}
