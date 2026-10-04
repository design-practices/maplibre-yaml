/**
 * @file Lower `fitTo` to a concrete camera (U14, ml-chh.9)
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * `fitTo` frames the initial camera on a source's data. The style spec has
 * no "fit to this source" — its root camera is `center`/`zoom` only — so the
 * honest style.json form is the camera the fit *would* produce. That is
 * computable at compile time exactly when the source's data is inline: the
 * bounds come from the same walk the live renderer uses
 * ({@link geojsonBounds}), and the zoom from MapLibre's own fit math over a
 * fixed reference viewport.
 *
 * It is a `fallback`, not an `ejects`: a live map fits ITS container, while
 * the emitted camera is fixed for {@link FIT_TO_REFERENCE_VIEWPORT}. So the
 * lowering is `lossy` (like markers): `--with-fallbacks` substitutes the
 * computed camera, `--strict` refuses. When the data is NOT inline (a `url:`
 * source, a tiled source, a missing name) nothing can be computed — the
 * emitted style keeps the authored `center`/`zoom`, said out loud.
 *
 * Same KTD4 shape as {@link lowerMarkers}: a pre-pass over the model, and
 * ONE implementation ({@link buildFitToLowering}) behind both the pre-pass
 * and the eject registry's `eject()` hook.
 */

import type { MapModel } from "../model/types";
import type { FitToConfig } from "../schemas/map.schema";
import type { EmitWarning } from "./project";
import { geojsonBounds, type Bounds } from "../interactions/geometry-bounds";

/**
 * The viewport the emitted camera is computed for. A desktop-ish 4:3 frame:
 * the emitted style has no container, so some size has to be assumed, and
 * the warning names it so the assumption is never silent.
 */
export const FIT_TO_REFERENCE_VIEWPORT = { width: 1024, height: 768 } as const;

/** MapLibre's world size at zoom 0, in CSS pixels (512px tiles). */
const WORLD_SIZE_Z0 = 512;
/** MapLibre's default maxZoom — where a degenerate (single-point) fit lands. */
const DEFAULT_MAX_ZOOM = 22;

/** Web-Mercator x in world units [0, 1]. */
function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

/** Web-Mercator y in world units [0, 1] (0 at the top). */
function mercatorY(lat: number): number {
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * The camera `map.fitBounds(bounds, { padding, maxZoom })` lands on for a
 * viewport of the given size (bearing 0, pitch 0) — MapLibre's own math:
 * the bounds' Mercator extent scaled to fit the padded viewport, centered on
 * the Mercator midpoint (not the lat/lng midpoint).
 */
export function cameraForBounds(
  bounds: Bounds,
  viewport: { width: number; height: number } = FIT_TO_REFERENCE_VIEWPORT,
  padding = 0,
  maxZoom = DEFAULT_MAX_ZOOM
): { center: [number, number]; zoom: number } {
  const [[west, south], [east, north]] = bounds;
  const x0 = mercatorX(west);
  const x1 = mercatorX(east);
  const y0 = mercatorY(north);
  const y1 = mercatorY(south);

  const usableW = Math.max(1, viewport.width - 2 * padding);
  const usableH = Math.max(1, viewport.height - 2 * padding);
  const spanX = (x1 - x0) * WORLD_SIZE_Z0;
  const spanY = (y1 - y0) * WORLD_SIZE_Z0;
  const scale = Math.min(
    spanX > 0 ? usableW / spanX : Infinity,
    spanY > 0 ? usableH / spanY : Infinity
  );
  const zoom = Math.max(0, Math.min(maxZoom, Number.isFinite(scale) ? Math.log2(scale) : maxZoom));

  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const lng = mx * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;

  return { center: [round(lng, 6), round(lat, 6)], zoom: round(zoom, 2) };
}

/** What a `fitTo` lowering produces. */
export interface FitToLowering {
  /** The computed camera, when the source's data is inline. */
  camera?: { center: [number, number]; zoom: number };
  warnings: EmitWarning[];
}

/**
 * Build the lowering for a `fitTo` against a model's sources. The single
 * implementation behind both {@link lowerFitTo} and the registry's
 * `eject()` hook.
 */
export function buildFitToLowering(fitTo: FitToConfig, model: MapModel): FitToLowering {
  const source = model.style.sources[fitTo.source];
  const keep = (reason: string): FitToLowering => ({
    warnings: [
      {
        path: "fitTo",
        kind: "lossy",
        construct: "fitTo",
        ejectClass: "fallback",
        message:
          `\`fitTo\` ${reason}, so the fit cannot be computed at compile time; ` +
          "the emitted style keeps the authored `center`/`zoom` instead of the " +
          "fitted camera the live map shows.",
      },
    ],
  });

  if (!source) return keep(`names "${fitTo.source}", which is not an entry in \`sources:\``);
  const spec = source.spec as Record<string, unknown>;
  if (spec["type"] !== "geojson") {
    return keep(
      `names a ${String(spec["type"])} source — only GeoJSON sources carry a ` +
        "client-side extent"
    );
  }
  if (spec["data"] === undefined) {
    return keep(`names "${fitTo.source}", whose data is fetched (\`url:\`) rather than inline`);
  }
  const bounds = geojsonBounds(spec["data"]);
  if (!bounds) return keep(`names "${fitTo.source}", whose inline data has no coordinates`);

  const camera = cameraForBounds(
    bounds,
    FIT_TO_REFERENCE_VIEWPORT,
    fitTo.padding ?? 0,
    fitTo.maxZoom ?? DEFAULT_MAX_ZOOM
  );
  const { width, height } = FIT_TO_REFERENCE_VIEWPORT;
  return {
    camera,
    warnings: [
      {
        path: "fitTo",
        kind: "lossy",
        construct: "fitTo",
        ejectClass: "fallback",
        message:
          `\`fitTo\` lowered to center [${camera.center.join(", ")}] / zoom ` +
          `${camera.zoom} — the fit of "${fitTo.source}" for a ${width}×${height} ` +
          "reference viewport. A live map fits its own container; the emitted " +
          "camera is fixed.",
      },
    ],
  };
}

/** What the pre-pass produced. */
export interface LoweredFitTo {
  /** The rewritten model: `fitTo` gone from runtime, camera replaced if computable. */
  model: MapModel;
  warnings: EmitWarning[];
}

/**
 * Lower `runtime.fitTo` into the model's camera. A model without `fitTo`
 * passes through untouched (same reference).
 */
export function lowerFitTo(model: MapModel): LoweredFitTo {
  const fitTo = model.runtime.fitTo;
  if (!fitTo) return { model, warnings: [] };

  const { camera, warnings } = buildFitToLowering(fitTo, model);
  const runtime = { ...model.runtime };
  delete runtime.fitTo;

  return {
    model: {
      ...model,
      runtime,
      style: camera
        ? { ...model.style, camera: { ...model.style.camera, ...camera } }
        : model.style,
    },
    warnings,
  };
}
