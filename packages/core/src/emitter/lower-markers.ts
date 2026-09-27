/**
 * @file Lower `markers:` to a symbol layer + pin sprites (U5, R5/R8 — KTD4)
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * The format's first fallback-class eject. `markers:` live as DOM markers
 * (`maplibregl.Marker`) the style spec cannot express; the honest style.json
 * form is a synthesized GeoJSON source + symbol layer whose icons are
 * generated pin sprites (U4's pipeline). Per KTD4 this is a PRE-PASS over
 * the model rather than logic inside `projectStyle`: the projection stays a
 * pure allowlist over the style half, and the lowering rewrites the model —
 * markers leave the runtime half, the synthesized source/layer join the
 * style half (appended last, so pins draw on top), and the assets ride out
 * on the result.
 *
 * The lowering is `lossy` by definition: a DOM marker and a symbol layer are
 * visually close but not identical (no drag, popups need attachInteractions,
 * collision behavior differs) — so `--strict` refuses marker documents and
 * `--with-fallbacks` substitutes, exactly the AE1/AE4 posture.
 */

import type { MapModel } from "../model/types";
import type { MarkerConfig } from "../schemas/map.schema";
import type { EmitAsset } from "./assets";
import type { EmitWarning } from "./project";
import { EmitError } from "./project";
import { pinSvg } from "./assets";

/** What the pre-pass produced. */
export interface LoweredMarkers {
  /** The rewritten model: markers gone from runtime, layer/source added. */
  model: MapModel;
  /** Pin sprite descriptors for the sheet (deduped by the pipeline). */
  assets: EmitAsset[];
  warnings: EmitWarning[];
}

/** The synthesized ids, fixed so consumers can target them. */
export const MARKERS_SOURCE_ID = "mlym-markers";
export const MARKERS_LAYER_ID = "mlym-markers";

/** The lowering pieces, independent of any model — the registry's `eject()`. */
export interface MarkersLowering {
  sourceSpec: Record<string, unknown>;
  layerSpec: Record<string, unknown>;
  assets: EmitAsset[];
  warnings: EmitWarning[];
}

/**
 * Build the lowering for a markers list. This is the single implementation
 * behind BOTH the eject registry's `eject()` hook (the doctrine's mechanical
 * contract for a fallback-class construct) and {@link lowerMarkers}' model
 * rewrite.
 */
export function buildMarkersLowering(markers: readonly MarkerConfig[]): MarkersLowering {
  const assets: EmitAsset[] = [];
  const warnings: EmitWarning[] = [];

  const features = markers.map((marker: MarkerConfig, index: number) => {
    // Icon URLs embed via the `images:`/fetch-at-emit stage (U6); until a
    // marker's icon can be fetched into the sprite, the honest fallback is
    // the default pin, said out loud.
    if (marker.icon !== undefined) {
      warnings.push({
        path: `markers[${index}].icon`,
        kind: "lossy",
        construct: "markers",
        ejectClass: "fallback",
        message:
          `\`icon\` URLs are not embedded at compile time yet; the emitted marker ` +
          "uses the default pin instead.",
      });
    }
    const pin = pinSvg({
      ...(marker.color !== undefined && marker.icon === undefined
        ? { color: marker.color }
        : {}),
      ...(marker.size !== undefined ? { size: marker.size } : {}),
    });
    assets.push(pin);

    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: marker.at },
      properties: { "mlym:icon": pin.name },
    };
  });

  warnings.push({
    path: "markers",
    kind: "lossy",
    construct: "markers",
    ejectClass: "fallback",
    message:
      `${markers.length} marker(s) lowered to a symbol layer ("${MARKERS_LAYER_ID}") ` +
      "with generated pin sprites. The pins render; DOM-marker behavior and " +
      "marker popup content do not compile (popups are dropped from the emitted style).",
  });

  return {
    sourceSpec: {
      type: "geojson",
      data: { type: "FeatureCollection", features },
    },
    layerSpec: {
      id: MARKERS_LAYER_ID,
      type: "symbol",
      source: MARKERS_SOURCE_ID,
      layout: {
        // Prefixed per KTD3: document sprite assets live under `mlym:`.
        "icon-image": ["concat", "mlym:", ["get", "mlym:icon"]],
        "icon-allow-overlap": true,
        // The pin's tip is its bottom-center — anchor there so the pin
        // points at the coordinate, exactly like a DOM marker.
        "icon-anchor": "bottom",
      },
    },
    assets,
    warnings,
  };
}

/**
 * Lower `runtime.markers` into the model's style half. A model without
 * markers passes through untouched (same reference).
 */
export function lowerMarkers(model: MapModel): LoweredMarkers {
  const markers = model.runtime.markers;
  if (!markers || markers.length === 0) {
    return { model, assets: [], warnings: [] };
  }

  // Refuse loudly on id collision — an authored source/layer named like the
  // synthesized ones would be silently clobbered/duplicated otherwise, the
  // exact silent-drop class the doctrine forbids.
  if (model.style.sources[MARKERS_SOURCE_ID] !== undefined) {
    throw new EmitError(
      `Cannot lower markers: the document already declares a source named ` +
        `"${MARKERS_SOURCE_ID}", which the lowering would overwrite. Rename it.`
    );
  }
  if (model.style.layers.some((l) => l.spec["id"] === MARKERS_LAYER_ID)) {
    throw new EmitError(
      `Cannot lower markers: the document already declares a layer named ` +
        `"${MARKERS_LAYER_ID}", which would collide with the synthesized pin layer. Rename it.`
    );
  }

  const { sourceSpec, layerSpec, assets, warnings } = buildMarkersLowering(markers);

  // The runtime half loses `markers`; the style half gains the lowering.
  const runtime = { ...model.runtime };
  delete runtime.markers;

  const lowered: MapModel = {
    ...model,
    runtime,
    style: {
      ...model.style,
      sources: {
        ...model.style.sources,
        [MARKERS_SOURCE_ID]: { spec: sourceSpec, runtime: {} },
      },
      // Appended last: pins draw on top, matching live DOM markers.
      layers: [...model.style.layers, { spec: layerSpec, runtime: {} }],
    },
  };

  return { model: lowered, assets, warnings };
}
