/**
 * @file Lower `markers:` to a symbol layer + pin sprites (U5, R5/R8 — KTD4)
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * The format's first construct that exports with a fallback. `markers:` live as DOM markers
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
import { pinSvg, imageAssetName } from "./assets";
import type { EmitImageRef } from "./assets";

/** What the pre-pass produced. */
export interface LoweredMarkers {
  /** The rewritten model: markers gone from runtime, layer/source added. */
  model: MapModel;
  /** Pin sprite descriptors for the sheet (deduped by the pipeline). */
  assets: EmitAsset[];
  /** Marker icon URLs to fetch into the sprite at emit time (U6). */
  images: EmitImageRef[];
  warnings: EmitWarning[];
}

/** The synthesized ids, fixed so consumers can target them. */
export const MARKERS_SOURCE_ID = "mlym-markers";
export const MARKERS_LAYER_ID = "mlym-markers";

/** The lowering pieces, independent of any model — the registry's `export()`. */
export interface MarkersLowering {
  sourceSpec: Record<string, unknown>;
  layerSpec: Record<string, unknown>;
  assets: EmitAsset[];
  /** Marker icon URLs to fetch into the sprite at emit time (U6). */
  images: EmitImageRef[];
  warnings: EmitWarning[];
}

/**
 * Build the lowering for a markers list. This is the single implementation
 * behind BOTH the export registry's `export()` hook (the doctrine's mechanical
 * contract for an exports-with-fallback construct) and {@link lowerMarkers}' model
 * rewrite.
 */
export function buildMarkersLowering(markers: readonly MarkerConfig[]): MarkersLowering {
  const assets: EmitAsset[] = [];
  const images: EmitImageRef[] = [];
  const warnings: EmitWarning[] = [];
  let hasIconMarkers = false;

  const features = markers.map((marker: MarkerConfig, index: number) => {
    // Icon URLs embed at compile time (U6): the emit pipeline fetches each
    // into the document sprite. Only absolute http(s) URLs embed — matching
    // what the live renderer's safeUrl gate accepts and what a compile-time
    // fetch can reach; anything else falls back to the default pin, said
    // out loud.
    if (marker.icon !== undefined && /^https?:/i.test(marker.icon)) {
      hasIconMarkers = true;
      const name = imageAssetName(marker.icon);
      images.push({ name, url: marker.icon });
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: marker.at },
        // Icons anchor center, matching the live DOM marker default; pins
        // anchor bottom (the tip points at the coordinate).
        properties: { "mlym:icon": name, "mlym:anchor": "center" },
      };
    }
    if (marker.icon !== undefined) {
      warnings.push({
        path: `markers[${index}].icon`,
        kind: "lossy",
        construct: "markers",
        exportClass: "exports-with-fallback",
        message:
          `\`icon\` URL scheme is not fetchable at compile time; the emitted ` +
          "marker uses the default pin instead.",
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
      properties: { "mlym:icon": pin.name, "mlym:anchor": "bottom" },
    };
  });

  warnings.push({
    path: "markers",
    kind: "lossy",
    construct: "markers",
    exportClass: "exports-with-fallback",
    message:
      `${markers.length} marker(s) lowered to a symbol layer ("${MARKERS_LAYER_ID}") ` +
      "with generated pin sprites. The pins render; DOM-marker behavior and " +
      "marker popup content do not compile (popups are dropped from the emitted style).",
  });

  return {
    images,
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
        // Pins anchor at their tip (bottom-center), exactly like a DOM
        // marker; embedded icon images anchor center, matching the live
        // default. Data-driven only when the document mixes both.
        "icon-anchor": hasIconMarkers ? ["get", "mlym:anchor"] : "bottom",
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
    return { model, assets: [], images: [], warnings: [] };
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

  const { sourceSpec, layerSpec, assets, images, warnings } = buildMarkersLowering(markers);

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

  return { model: lowered, assets, images, warnings };
}
