/**
 * @file Spot a map center written [latitude, longitude]
 * @module @maplibre-yaml/core/utils/swapped-center
 *
 * @description
 * MapLibre (and GeoJSON) order coordinates [longitude, latitude]; many web
 * maps show latitude first, so `center: [40.75, -73.98]` is a very common
 * slip. The map then opens somewhere empty with no error (ml-aot.65).
 *
 * The swap is reported only when it is plainly what happened: the swapped
 * pair lands ON the document's places and the written one is far off --
 * further from them than they are spread out. A story whose chapters are far
 * apart (a world tour, one chapter on another continent) is not a swap
 * (ml-aot.71): there the places span the distance, so nothing is "far off".
 */

import type { Bounds } from "../interactions/geometry-bounds";

/** The bounding box of some [lng, lat] points, or `null` for none. */
export function boundsOfPoints(points: ReadonlyArray<readonly [number, number]>): Bounds | null {
  if (points.length === 0) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/**
 * The swapped center to suggest, or `null` when the center looks intended.
 *
 * @param bounds - The box around the document's places.
 * @param points - The places themselves, when known: then the swapped pair
 *   must land on one of them, not merely inside their box (a chapter in
 *   Nairobi among European ones swaps to a point near Spain, ml-aot.71).
 */
export function swappedCenter(
  center: unknown,
  bounds: Bounds | null,
  points?: ReadonlyArray<readonly [number, number]>
): [number, number] | null {
  if (!bounds || !Array.isArray(center) || center.length < 2) return null;
  const [lng, lat] = center as [number, number];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  // The swapped pair must itself be a valid [lng, lat].
  if (Math.abs(lng) > 90 || Math.abs(lat) > 180) return null;
  const [[west, south], [east, north]] = bounds;
  const spread = Math.max(east - west, north - south);
  /** Degrees from the box (0 inside it). */
  const away = (x: number, y: number) =>
    Math.max(west - x, x - east, 0, south - y, y - north);
  // Lands on the places: inside their box, or within a quarter of their
  // spread (at least a degree) of it.
  let landsOn = away(lat, lng) <= Math.max(1, spread * 0.25);
  if (landsOn && points && points.length > 0) {
    const reach = Math.max(1, spread * 0.1);
    landsOn = points.some(([x, y]) => Math.abs(x - lat) <= reach && Math.abs(y - lng) <= reach);
  }
  // Far off: further from the places than they are spread out (and at least
  // ten degrees), so a center merely beside them never counts.
  const farOff = away(lng, lat) > Math.max(10, spread);
  return landsOn && farOff ? [lat, lng] : null;
}
