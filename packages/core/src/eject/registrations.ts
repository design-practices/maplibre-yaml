/**
 * @file The closed world: every current construct's declared eject class
 * @module @maplibre-yaml/core/eject
 *
 * @description
 * One registration per runtime construct in the format today. The
 * exhaustiveness test (tests/eject/registry.test.ts) recomputes this list
 * from the model's own key boundaries (`LAYER_RUNTIME_KEYS`,
 * `SOURCE_RUNTIME_KEYS`, the `RuntimeHalf` fields), so adding a runtime key
 * without declaring its eject class fails the suite — the list cannot rot.
 *
 * `onEmit` strings are author-facing: they appear verbatim in `mlym emit`
 * warnings and the docs eject-class table.
 */

import { EjectClassRegistry } from "./registry";
import {
  buildMarkersLowering,
  MARKERS_SOURCE_ID,
} from "../emitter/lower-markers";
import type { MarkerConfig } from "../schemas/map.schema";

/**
 * The default registry every emit path consults.
 *
 * @remarks
 * Deliberately a module singleton, unlike `ExtensionRegistry` and
 * `InteractionRegistry` (which are per-host instances because different
 * hosts trust different namespaces/interactions). Eject classes are a
 * property of the FORMAT, not of a host: `layer.interactive` means the same
 * thing in every process, so per-caller registries would only invite two
 * copies of the truth. Consumers registering their own constructs (the
 * chrome/effects tiers do) share the format-wide namespace — core-owned
 * names are single words or `layer.`/`source.`-prefixed; third parties
 * should prefix with their package name to stay clear of future core
 * registrations.
 */
export const ejectClasses = new EjectClassRegistry();

// ---------------------------------------------------------------------------
// Layer runtime constructs (LAYER_RUNTIME_KEYS)
// ---------------------------------------------------------------------------

ejectClasses.register("layer.interactive", {
  class: "declared-absence",
  onEmit:
    "Interactions (popups, hover, highlight) are runtime behavior with no style.json " +
    "form; the emitted style renders the layer without them. attachInteractions() " +
    "restores them over an ejected style.",
});

ejectClasses.register("layer.legend", {
  class: "declared-absence",
  onEmit:
    "Legend entries are chrome, not cartography; the emitted style has no legend surface.",
});

ejectClasses.register("layer.label", {
  class: "declared-absence",
  onEmit: "Display labels are chrome metadata and are absent from the emitted style.",
});

ejectClasses.register("layer.toggleable", {
  class: "declared-absence",
  onEmit:
    "Toggleability is user-interaction surface; the emitted style carries the layer's " +
    "authored visibility and no toggle.",
});

ejectClasses.register("layer.before", {
  class: "ejects",
  onEmit:
    "Placement compiles honestly: the emitted layers array is ordered so the layer sits " +
    "where `before:` put it (and EmitResult.placements carries the intent).",
});

// ---------------------------------------------------------------------------
// Source runtime constructs (SOURCE_RUNTIME_KEYS — the live-data machinery)
// ---------------------------------------------------------------------------

const LIVE_DATA_ON_EMIT =
  "Live-data machinery does not compile; the emitted source carries the data " +
  "present at compile time.";

for (const key of [
  "source.refresh",
  "source.stream",
  "source.cache",
  "source.loading",
  "source.prefetchedData",
  "source.fetchStrategy",
  "source.refreshInterval",
  "source.updateStrategy",
  "source.updateKey",
]) {
  ejectClasses.register(key, { class: "declared-absence", onEmit: LIVE_DATA_ON_EMIT });
}

// ---------------------------------------------------------------------------
// Document/root runtime constructs (RuntimeHalf fields + spec-native state)
// ---------------------------------------------------------------------------

ejectClasses.register("map.options", {
  class: "declared-absence",
  onEmit:
    "MapLibre constructor options are host decisions with no style-spec equivalent; " +
    "the emitted style uses MapLibre's defaults.",
});

ejectClasses.register("controls", {
  class: "declared-absence",
  onEmit:
    "Controls are DOM chrome; the emitted style renders the map with MapLibre's default " +
    "control set only.",
});

ejectClasses.register("legend", {
  class: "declared-absence",
  onEmit: "The legend is DOM chrome; the emitted style has no legend surface.",
});

ejectClasses.register("container", {
  class: "declared-absence",
  onEmit:
    "Container styling (className, inline style) belongs to the host page, not the style.",
});

ejectClasses.register("parameters", {
  class: "declared-absence",
  onEmit:
    "Parameter presentation metadata (labels, control types) is UI surface; the state " +
    "values themselves eject via `state:` (inlined as defaults below the runtime floor).",
});

ejectClasses.register("state", {
  class: "ejects",
  onEmit:
    "`state:` is a style-spec root property and compiles through verbatim on runtimes " +
    "that support it; below the global-state floor the defaults are inlined into " +
    "expressions instead (the inlineState gate).",
});

ejectClasses.register("markers", {
  class: "fallback",
  onEmit:
    "Markers lower to a symbol layer with generated pin sprites — the pins " +
    "render in the emitted style (lossy: DOM-marker behavior like dragging " +
    "and built-in popups does not compile).",
  // The doctrine's mechanical contract for a fallback-class construct: the
  // lowering IS the registration. `lowerMarkers` (the emit pre-pass) and this
  // hook share one implementation.
  eject: (ctx) => {
    const { sourceSpec, layerSpec, assets, warnings } = buildMarkersLowering(
      ctx.value as MarkerConfig[]
    );
    return {
      sources: { [MARKERS_SOURCE_ID]: sourceSpec },
      layers: [layerSpec],
      assets,
      warnings,
    };
  },
});

ejectClasses.register("x-*", {
  class: "declared-absence",
  onEmit:
    "Extension blocks are host-side data validated by the extension registry; they are " +
    "never part of the emitted style.",
});
