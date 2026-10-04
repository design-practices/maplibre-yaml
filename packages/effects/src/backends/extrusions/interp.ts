/**
 * @file Zoom interpolation factor — main-thread half of composite expressions
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * MapLibre's `CompositeExpressionBinder` evaluates a zoom-and-data value at
 * the tile's zoom `z` and `z + 1` and blends with
 * `clamp(interpolationFactor(mapZoom, z, z + 1), 0, 1)`. The worker does
 * the evaluation (see expressions.ts); this computes the factor per frame
 * without pulling the style-spec evaluator onto the main thread.
 */

import type { ZoomInterp } from "./expressions";

function exponential(input: number, base: number, lower: number, upper: number): number {
  const difference = upper - lower;
  const progress = input - lower;
  if (difference === 0) return 0;
  if (base === 1) return progress / difference;
  return (Math.pow(base, progress) - 1) / (Math.pow(base, difference) - 1);
}

/** Solve a CSS-style cubic bezier (p0 = 0,0; p3 = 1,1) for y at x. */
function cubicBezier(x: number, [x1, y1, x2, y2]: [number, number, number, number]): number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sx(t) - x;
    if (Math.abs(err) < 1e-6) return sy(t);
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0, hi = 1;
  t = x;
  while (lo < hi && hi - lo > 1e-6) {
    const v = sx(t);
    if (Math.abs(v - x) < 1e-6) break;
    if (x > v) lo = t;
    else hi = t;
    t = (hi + lo) / 2;
  }
  return sy(t);
}

/** The blend factor between the values evaluated at `tileZoom` and `tileZoom + 1`. */
export function zoomFactor(interp: ZoomInterp, mapZoom: number, tileZoom: number): number {
  if (!interp.zoomDependent || !interp.type) return 0;
  const lower = tileZoom, upper = tileZoom + 1;
  let f: number;
  switch (interp.type.name) {
    case "exponential":
      f = exponential(mapZoom, interp.type.base, lower, upper);
      break;
    case "cubic-bezier":
      f = cubicBezier(Math.min(1, Math.max(0, exponential(mapZoom, 1, lower, upper))), interp.type.controlPoints);
      break;
    default:
      f = exponential(mapZoom, 1, lower, upper);
  }
  return Math.min(1, Math.max(0, f));
}
