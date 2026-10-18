/**
 * @file Spot a map center written [latitude, longitude]
 * @module @maplibre-yaml/core/utils/swapped-center
 *
 * @description
 * MapLibre (and GeoJSON) order coordinates [longitude, latitude]; many web
 * maps show latitude first, so `center: [40.75, -73.98]` is a very common
 * slip. The map then opens somewhere empty with no error (ml-aot.65). Given
 * the bounds of the document's own data: when the center is far from them
 * and the swapped pair lands on them, the swap is almost certainly meant.
 */

import type { Bounds } from "../interactions/geometry-bounds";

/** The swapped center to suggest, or `null` when the center looks intended. */
export function swappedCenter(center: unknown, bounds: Bounds | null): [number, number] | null {
  if (!bounds || !Array.isArray(center) || center.length < 2) return null;
  const [lng, lat] = center as [number, number];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  // The swapped pair must itself be a valid [lng, lat].
  if (Math.abs(lng) > 90) return null;
  const [[west, south], [east, north]] = bounds;
  // Generous padding: "near the data" covers a map deliberately centred a
  // little off it (a region around a few points).
  const padLng = Math.max(1, (east - west) * 0.5);
  const padLat = Math.max(1, (north - south) * 0.5);
  const near = (x: number, y: number) =>
    x >= west - padLng && x <= east + padLng && y >= south - padLat && y <= north + padLat;
  if (near(lng, lat)) return null;
  return near(lat, lng) ? [lat, lng] : null;
}
