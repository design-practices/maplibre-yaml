/**
 * @file The static layer's own expressions, evaluated off the main thread
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * The effect draws the SAME buildings, at the SAME heights, as the static
 * layer it replaces — so it evaluates that layer's own `filter`,
 * `fill-extrusion-height` and `fill-extrusion-base` with MapLibre's
 * style-spec evaluator, never a hard-coded schema field (no
 * `render_height` assumptions: any source schema works).
 *
 * Zoom-dependent values follow MapLibre's composite-expression scheme
 * exactly: a tile at (overscaled) zoom `z` evaluates each feature at `z`
 * and `z + 1`, and the renderer interpolates between the two with
 * `interpolationFactor(mapZoom, z, z + 1)` clamped to [0, 1] — so a zoom
 * ramp in the static layer (Tangram's height exaggeration, say) animates
 * identically under the effect.
 *
 * Runs in the mesh worker; also importable on the main thread (tests).
 */

import {
  normalizePropertyExpression,
  featureFilter,
  type StylePropertySpecification,
} from "@maplibre/maplibre-gl-style-spec";

/** How a value changes with zoom, for the main thread's interpolation. */
export interface ZoomInterp {
  /** False for constant/data-only values: lo == hi, factor irrelevant. */
  zoomDependent: boolean;
  /** Absent for step-like (non-interpolated) expressions: factor 0. */
  type?:
    | { name: "linear" }
    | { name: "exponential"; base: number }
    | { name: "cubic-bezier"; controlPoints: [number, number, number, number] };
}

/** A compiled numeric paint property. */
export interface CompiledNumber {
  evaluate(zoom: number, feature: unknown): number;
  interp: ZoomInterp;
}

/** The style-spec property spec shared by fill-extrusion-height/-base. */
const EXTRUSION_SPEC = {
  type: "number",
  default: 0,
  minimum: 0,
  units: "meters",
  "property-type": "data-driven",
  expression: { interpolated: true, parameters: ["zoom", "feature", "feature-state"] },
  transition: true,
} as unknown as StylePropertySpecification;

/**
 * Compile `fill-extrusion-height` / `-base` (authored value, possibly
 * undefined → the spec default 0).
 *
 * @throws with the style-spec's own message when the expression is invalid.
 */
export function compileExtrusionValue(value: unknown, rootKey: string): CompiledNumber {
  if (value === undefined || value === null) {
    return { evaluate: () => 0, interp: { zoomDependent: false } };
  }
  const expr = normalizePropertyExpression(
    value as never,
    rootKey,
    EXTRUSION_SPEC
  ) as unknown as {
    kind: string;
    interpolationType?: { name: string; base?: number; controlPoints?: number[] } | null;
    evaluate(globals: { zoom: number }, feature?: unknown): unknown;
  };
  const zoomDependent = expr.kind === "camera" || expr.kind === "composite";
  let type: ZoomInterp["type"];
  const it = expr.interpolationType;
  if (zoomDependent && it) {
    if (it.name === "exponential") type = { name: "exponential", base: it.base ?? 1 };
    else if (it.name === "cubic-bezier" && it.controlPoints?.length === 4)
      type = { name: "cubic-bezier", controlPoints: it.controlPoints as [number, number, number, number] };
    else type = { name: "linear" };
  }
  return {
    evaluate(zoom, feature) {
      const v = Number(expr.evaluate({ zoom }, feature));
      return Number.isFinite(v) ? v : 0;
    },
    interp: { zoomDependent, ...(type ? { type } : {}) },
  };
}

/** Compile the static layer's filter (absent = every feature passes). */
export function compileFilter(filter: unknown, rootKey: string): (zoom: number, feature: unknown) => boolean {
  if (filter === undefined || filter === null) return () => true;
  const compiled = featureFilter(filter as never, rootKey);
  return (zoom, feature) => compiled.filter({ zoom } as never, feature as never);
}
