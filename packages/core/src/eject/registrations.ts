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

// The first registration whose eject() carries real computation from the
// emitter layer (every declared-absence entry above is a pure string). The
// import deliberately targets emitter/lower-markers DIRECTLY, never the
// emitter barrel — the barrel re-exports project.ts, which imports this
// file, and only the direct-file import keeps that from becoming a require
// cycle. Future fallback registrations follow the same rule.
ejectClasses.register("markers", {
  class: "fallback",
  onEmit:
    "Markers lower to a symbol layer with generated pin sprites — the pins " +
    "render in the emitted style (lossy: DOM-marker behavior like dragging " +
    "and built-in popups does not compile).",
  // The doctrine's mechanical contract for a fallback-class construct: this
  // hook and `lowerMarkers` (the emit pre-pass, which the CLI actually runs)
  // share ONE implementation — buildMarkersLowering — and a parity test pins
  // that they cannot drift.
  eject: (ctx) => {
    const { sourceSpec, layerSpec, assets, images, warnings } = buildMarkersLowering(
      ctx.value as MarkerConfig[]
    );
    return {
      sources: { [MARKERS_SOURCE_ID]: sourceSpec },
      layers: [layerSpec],
      assets,
      images,
      warnings,
    };
  },
});

// Style-half construct (U6): registered so the docs eject-class table and
// programmatic consumers can see its declared behavior. It never reaches the
// projection's RUNTIME loop; the projection itself reports the two edges
// (relative URLs are lossy, dynamic references warn as contract).
ejectClasses.register("images", {
  class: "ejects",
  onEmit:
    "Named images with absolute http(s) URLs are fetched at compile time and " +
    "merged into the document sprite; literal layer references are rewritten " +
    "to `mlym:<name>` so they resolve in the emitted style. Relative URLs " +
    "cannot compile (lossy).",
});

// Style-half 3D constructs (U15). Like `images`, registered for the docs
// table and programmatic consumers; the projection compiles them directly
// and reports their edges itself (an unresolvable terrain source is lossy;
// a declared emit target below a floor is lossy via the runtime gate).
ejectClasses.register("terrain", {
  class: "ejects",
  onEmit:
    "`terrain:` is a style-spec root property and compiles through verbatim; the " +
    "document's terrain wins over a basemap's. A `source` that resolves to no " +
    "raster-dem source is dropped (lossy) rather than shipped invalid.",
});

ejectClasses.register("sky", {
  class: "ejects",
  onEmit:
    "`sky:` is a style-spec root property and compiles through verbatim; the " +
    "document's sky wins over a basemap's. Runtimes below maplibre-gl 4.5.0 do not " +
    "draw it (reported as lossy against a declared --target).",
});

ejectClasses.register("projection", {
  class: "ejects",
  onEmit:
    "`projection:` is a style-spec root property and compiles through verbatim; the " +
    "document's projection wins over a basemap's. Globe needs maplibre-gl 5.0.0 — " +
    "older runtimes render mercator (reported as lossy against a declared --target).",
});

// Style-half construct (U10′): the style-spec root `light`, applied live
// with `map.setLight` and compiled through verbatim on eject.
ejectClasses.register("light", {
  class: "ejects",
  onEmit:
    "`light:` is the style-spec root light and compiles through verbatim to the " +
    "emitted style's `light`, replacing any basemap light.",
});

ejectClasses.register("x-*", {
  class: "declared-absence",
  onEmit:
    "Extension blocks are host-side data validated by the extension registry; they are " +
    "never part of the emitted style.",
});
