/**
 * @file The closed world: every current construct's declared export class
 * @module @maplibre-yaml/core/export
 *
 * @description
 * One registration per runtime construct in the format today. The
 * exhaustiveness test (tests/export/registry.test.ts) recomputes this list
 * from the model's own key boundaries (`LAYER_RUNTIME_KEYS`,
 * `SOURCE_RUNTIME_KEYS`, the `RuntimeHalf` fields), so adding a runtime key
 * without declaring its export class fails the suite — the list cannot rot.
 *
 * `onEmit` strings are author-facing: they appear verbatim in `mlym emit`
 * warnings and the docs export-class table.
 */

import { ExportClassRegistry } from "./registry";
import {
  buildMarkersLowering,
  MARKERS_SOURCE_ID,
} from "../emitter/lower-markers";
import { buildFitToLowering } from "../emitter/lower-fit-to";
import type { MarkerConfig, FitToConfig } from "../schemas/map.schema";
import { lowerEffectLayer, EFFECT_ON_EMIT } from "../emitter/lower-effects";

/**
 * The default registry every emit path consults.
 *
 * @remarks
 * Deliberately a module singleton, unlike `ExtensionRegistry` and
 * `InteractionRegistry` (which are per-host instances because different
 * hosts trust different namespaces/interactions). Export classes are a
 * property of the FORMAT, not of a host: `layer.interactive` means the same
 * thing in every process, so per-caller registries would only invite two
 * copies of the truth. Consumers registering their own constructs (the
 * chrome/effects tiers do) share the format-wide namespace — core-owned
 * names are single words or `layer.`/`source.`-prefixed; third parties
 * should prefix with their package name to stay clear of future core
 * registrations.
 */
export const exportClasses = new ExportClassRegistry();

// ---------------------------------------------------------------------------
// Layer runtime constructs (LAYER_RUNTIME_KEYS)
// ---------------------------------------------------------------------------

exportClasses.register("layer.interactive", {
  class: "no-export",
  onEmit:
    "Interactions (popups, hover, highlight) are runtime behavior with no style.json " +
    "form; the emitted style renders the layer without them. attachInteractions() " +
    "restores them over an exported style.",
});

exportClasses.register("layer.legend", {
  class: "no-export",
  onEmit:
    "Legend entries are chrome, not cartography; the emitted style has no legend surface.",
});

exportClasses.register("layer.label", {
  class: "no-export",
  onEmit: "Display labels are chrome metadata and are absent from the emitted style.",
});

exportClasses.register("layer.toggleable", {
  class: "no-export",
  onEmit:
    "Toggleability is user-interaction surface; the emitted style carries the layer's " +
    "authored visibility and no toggle.",
});

exportClasses.register("layer.before", {
  class: "exports",
  onEmit:
    "Placement compiles honestly: the emitted layers array is ordered so the layer sits " +
    "where `before:` put it (and EmitResult.placements carries the intent).",
});

// Experimental (0.7, @maplibre-yaml/effects). The fallback is the layer the
// effect sits on; the export() and the projection share lowerEffectLayer
// (imported directly, never via the emitter barrel — see `markers` below).
exportClasses.register("layer.effect", {
  class: "exports-with-fallback",
  onEmit: EFFECT_ON_EMIT,
  export: (ctx) => {
    const { layer, effect } = ctx.value as {
      layer: Record<string, unknown>;
      effect: unknown;
    };
    const lowered = lowerEffectLayer(layer, effect);
    return {
      ...(lowered.layer ? { layers: [lowered.layer] } : {}),
      warnings: [lowered.warning],
    };
  },
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
  exportClasses.register(key, { class: "no-export", onEmit: LIVE_DATA_ON_EMIT });
}

// ---------------------------------------------------------------------------
// Document/root runtime constructs (RuntimeHalf fields + spec-native state)
// ---------------------------------------------------------------------------

exportClasses.register("map.options", {
  class: "no-export",
  onEmit:
    "MapLibre constructor options are host decisions with no style-spec equivalent; " +
    "the emitted style uses MapLibre's defaults.",
});

exportClasses.register("controls", {
  class: "no-export",
  onEmit:
    "Controls are DOM chrome; the emitted style renders the map with MapLibre's default " +
    "control set only.",
});

exportClasses.register("legend", {
  class: "no-export",
  onEmit: "The legend is DOM chrome; the emitted style has no legend surface.",
});

exportClasses.register("container", {
  class: "no-export",
  onEmit:
    "Container styling (className, inline style) belongs to the host page, not the style.",
});

exportClasses.register("parameters", {
  class: "no-export",
  onEmit:
    "Parameter presentation metadata (labels, control types) is UI surface; the state " +
    "values themselves export via `state:` (inlined as defaults below the runtime floor).",
});

exportClasses.register("state", {
  class: "exports",
  onEmit:
    "`state:` is a style-spec root property and compiles through verbatim on runtimes " +
    "that support it; below the global-state floor the defaults are inlined into " +
    "expressions instead (the inlineState gate).",
});

// The first registration whose export() carries real computation from the
// emitter layer (every no-export entry above is a pure string). The
// import deliberately targets emitter/lower-markers DIRECTLY, never the
// emitter barrel — the barrel re-exports project.ts, which imports this
// file, and only the direct-file import keeps that from becoming a require
// cycle. Future exports-with-fallback registrations follow the same rule.
exportClasses.register("markers", {
  class: "exports-with-fallback",
  onEmit:
    "Markers lower to a symbol layer with generated pin sprites — the pins " +
    "render in the emitted style (lossy: DOM-marker behavior like dragging " +
    "and built-in popups does not compile).",
  // The doctrine's mechanical contract for an exports-with-fallback construct: this
  // hook and `lowerMarkers` (the emit pre-pass, which the CLI actually runs)
  // share ONE implementation — buildMarkersLowering — and a parity test pins
  // that they cannot drift.
  export: (ctx) => {
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

// U14: the fit-to-data initial camera. Fallback: an inline GeoJSON source's
// bounds compile to a concrete center/zoom (for a fixed reference viewport —
// lossy, a live map fits its own container); a fetched or tiled source cannot
// be fit at compile time and keeps the authored camera, said out loud. Same
// one-implementation rule as markers: this hook and `lowerFitTo` share
// buildFitToLowering (direct-file import, never the emitter barrel).
exportClasses.register("fitTo", {
  class: "exports-with-fallback",
  onEmit:
    "The fit-to-data camera lowers to a concrete center/zoom when the named " +
    "source's GeoJSON is inline (computed for a 1024×768 reference viewport — " +
    "lossy, a live map fits its own container); for fetched or tiled sources " +
    "the authored center/zoom stand in.",
  export: (ctx) => {
    if (!ctx.model) {
      return {
        warnings: [
          {
            path: ctx.path,
            kind: "lossy",
            construct: "fitTo",
            exportClass: "exports-with-fallback",
            message:
              "`fitTo` needs the document's sources to compute a camera; none " +
              "were provided, so the authored center/zoom stand in.",
          },
        ],
      };
    }
    const { camera, warnings } = buildFitToLowering(ctx.value as FitToConfig, ctx.model);
    return { ...(camera ? { camera } : {}), warnings };
  },
});

// U14: popups open at a coordinate. A popup is DOM chrome with no style
// form — a text label would silently drop its content model and its
// open/close behavior, so the honest class is no-export.
exportClasses.register("popups", {
  class: "no-export",
  onEmit:
    "Standalone popups are DOM chrome with no style.json form; the emitted style " +
    "renders the map without them.",
});

// U14: the color-relief layer TYPE. A style-half construct (it compiles
// through verbatim as a spec layer), registered so the docs table and
// programmatic consumers see the runtime-floor caveat: the runtime gate
// reports it lossy when a declared --target is below maplibre-gl 5.6.
exportClasses.register("color-relief", {
  class: "exports",
  onEmit:
    "color-relief layers compile through verbatim (a style-spec layer type); they " +
    "need maplibre-gl 5.6+ to render, so emitting for a lower --target is " +
    "reported as lossy.",
});

// Style-half construct (U6): registered so the docs export-class table and
// programmatic consumers can see its declared behavior. It never reaches the
// projection's RUNTIME loop; the projection itself reports the two edges
// (relative URLs are lossy, dynamic references warn as contract).
exportClasses.register("images", {
  class: "exports",
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
exportClasses.register("terrain", {
  class: "exports",
  onEmit:
    "`terrain:` is a style-spec root property and compiles through verbatim; the " +
    "document's terrain wins over a basemap's. A `source` that resolves to no " +
    "raster-dem source is dropped (lossy) rather than shipped invalid.",
});

exportClasses.register("sky", {
  class: "exports",
  onEmit:
    "`sky:` is a style-spec root property and compiles through verbatim; the " +
    "document's sky wins over a basemap's. Runtimes below maplibre-gl 4.5.0 do not " +
    "draw it (reported as lossy against a declared --target).",
});

exportClasses.register("projection", {
  class: "exports",
  onEmit:
    "`projection:` is a style-spec root property and compiles through verbatim; the " +
    "document's projection wins over a basemap's. Globe needs maplibre-gl 5.0.0 — " +
    "older runtimes render mercator (reported as lossy against a declared --target).",
});

// Style-half construct (U10′): the style-spec root `light`, applied live
// with `map.setLight` and compiled through verbatim on export.
exportClasses.register("light", {
  class: "exports",
  onEmit:
    "`light:` is the style-spec root light and compiles through verbatim to the " +
    "emitted style's `light`, replacing any basemap light.",
});

exportClasses.register("x-*", {
  class: "no-export",
  onEmit:
    "Extension blocks are host-side data validated by the extension registry; they are " +
    "never part of the emitted style.",
});
