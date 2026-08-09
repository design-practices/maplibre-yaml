/**
 * @file Hand-rolled GeoJSON geometry bounding-box helper
 * @module @maplibre-yaml/core/interactions
 *
 * @remarks
 * The geometry half of the `zoomToFeature` click interaction: given a clicked
 * feature's geometry, compute the axis-aligned bounding box the camera fits to.
 *
 * Deliberately dependency-free. There is no `@turf/*` in this repo and this one
 * traversal does not justify adding one — the walk is a handful of lines and the
 * only surface it needs is `[[minLng, minLat], [maxLng, maxLat]]`.
 *
 * The traversal is coordinate-shape driven rather than type-driven: every
 * geometry except `GeometryCollection` bottoms out in nested arrays of
 * positions, so one recursive walk over `coordinates` covers Point through
 * MultiPolygon, and `GeometryCollection` is the single structural special case.
 * A position may carry an altitude (`[lng, lat, z]`); the z is ignored.
 */

/** An axis-aligned bounding box: `[[minLng, minLat], [maxLng, maxLat]]`. */
export type Bounds = [[number, number], [number, number]];

/** Mutable min/max accumulator; `seen` guards the all-empty → null contract. */
interface Extent {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  seen: boolean;
}

/**
 * A GeoJSON-ish geometry. Intentionally loose: the clicked feature arrives from
 * MapLibre as `any`, so this helper validates shape as it walks rather than
 * trusting a declared type.
 */
interface GeometryLike {
  type?: string;
  coordinates?: unknown;
  geometries?: unknown;
}

/** Whether `value` is a bare position — an array whose first element is a number. */
function isPosition(value: unknown[]): boolean {
  return typeof value[0] === "number";
}

/** Fold one position's lng/lat into the extent, ignoring any altitude (z). */
function extendWithPosition(extent: Extent, position: unknown[]): void {
  const lng = position[0];
  const lat = position[1];
  if (typeof lng !== "number" || typeof lat !== "number") return;
  if (!extent.seen) {
    extent.minLng = extent.maxLng = lng;
    extent.minLat = extent.maxLat = lat;
    extent.seen = true;
    return;
  }
  if (lng < extent.minLng) extent.minLng = lng;
  if (lng > extent.maxLng) extent.maxLng = lng;
  if (lat < extent.minLat) extent.minLat = lat;
  if (lat > extent.maxLat) extent.maxLat = lat;
}

/** Walk arbitrarily nested coordinate arrays down to their positions. */
function walkCoordinates(extent: Extent, coordinates: unknown): void {
  if (!Array.isArray(coordinates)) return;
  if (isPosition(coordinates)) {
    extendWithPosition(extent, coordinates);
    return;
  }
  for (const child of coordinates) walkCoordinates(extent, child);
}

/** Walk one geometry, recursing into a GeometryCollection's members. */
function walkGeometry(extent: Extent, geometry: unknown): void {
  if (!geometry || typeof geometry !== "object") return;
  const geom = geometry as GeometryLike;
  if (geom.type === "GeometryCollection") {
    if (!Array.isArray(geom.geometries)) return;
    for (const member of geom.geometries) walkGeometry(extent, member);
    return;
  }
  walkCoordinates(extent, geom.coordinates);
}

/**
 * The bounding box of a GeoJSON geometry, or `null` when there is nothing to
 * bound.
 *
 * @param geometry - Any GeoJSON geometry (Point, LineString, Polygon, the Multi*
 *   variants, or GeometryCollection). Loosely typed because the clicked feature
 *   reaches the interaction as `any`.
 * @returns `[[minLng, minLat], [maxLng, maxLat]]`, degenerate for a single
 *   point; `null` for a missing, empty, or coordinate-free geometry so the
 *   caller can no-op instead of calling `fitBounds` with nothing.
 */
export function geometryBounds(geometry: unknown): Bounds | null {
  const extent: Extent = {
    minLng: 0,
    minLat: 0,
    maxLng: 0,
    maxLat: 0,
    seen: false,
  };
  walkGeometry(extent, geometry);
  if (!extent.seen) return null;
  return [
    [extent.minLng, extent.minLat],
    [extent.maxLng, extent.maxLat],
  ];
}
