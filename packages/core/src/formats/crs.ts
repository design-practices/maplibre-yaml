/**
 * @file Is this longitude/latitude? The CRS rule both feature readers share (0.9, ml-cnv)
 * @module @maplibre-yaml/core/formats/crs
 *
 * @description
 * MapLibre draws GeoJSON coordinates as longitude/latitude. A FlatGeobuf or
 * GeoParquet file in a projected CRS (Web Mercator, UTM, a state plane)
 * would land in the wrong place — or nowhere — so both readers refuse it
 * with a reprojection hint. The rule:
 *
 * - a known geographic EPSG code (4326, the national datums) or `CRS84`:
 *   yes — unless the extent says otherwise (a mislabelled file);
 * - a known projected code (Web Mercator, UTM): no;
 * - any other code, or none: the extent decides — within ±180/±90 is
 *   longitude/latitude; a projected file's coordinates run far past it.
 *   With no extent either, the file is given the benefit of the doubt.
 *
 * Pure (no network, no library), so each reader's chunk carries only this.
 */

/**
 * Geographic (longitude/latitude) EPSG codes MapLibre can draw as-is: WGS 84
 * and the national datums that differ from it by metres at most. Any
 * EPSG:4xxx code below 4400 is a geographic 2D CRS by the registry's own
 * numbering; these are the ones outside that block.
 */
const LON_LAT_CODES = new Set([
  4326, 4979, // WGS 84 (2D, 3D)
  4269, 6318, 4152, 4759, // NAD83 and its realizations
  4258, 4937, // ETRS89
  4283, 7844, // GDA94, GDA2020
  4612, 6668, // JGD2000, JGD2011
  4617, 4619, 4148, 4674, 4686, 4490, 4167, 4624, 4171, 5340, 4818, 9777,
]);

/**
 * Projected EPSG codes that are common enough to name outright, so a file
 * whose small extent happens to fit inside ±180/±90 is still refused: Web
 * Mercator (and its legacy aliases), World Mercator, and the UTM zones.
 */
function isKnownProjected(code: number): boolean {
  return (
    code === 3857 ||
    code === 900913 ||
    code === 3395 ||
    code === 102100 ||
    code === 102113 ||
    (code >= 32601 && code <= 32660) || // WGS 84 / UTM north
    (code >= 32701 && code <= 32760) || // WGS 84 / UTM south
    (code >= 25828 && code <= 25838) || // ETRS89 / UTM
    (code >= 26901 && code <= 26923) // NAD83 / UTM
  );
}

/** Whether an EPSG code is a known geographic CRS. */
function isGeographicCode(code: number): boolean {
  return LON_LAT_CODES.has(code) || (code >= 4000 && code < 4400);
}

/** Whether an extent `[w, s, e, n]` lies within longitude/latitude bounds (a little slack). */
export function withinLonLat(env: readonly number[]): boolean {
  const [w, s, e, n] = env as [number, number, number, number];
  return Math.abs(w) <= 180.5 && Math.abs(e) <= 180.5 && Math.abs(s) <= 90.5 && Math.abs(n) <= 90.5;
}

/** What a file says about its coordinates. */
export interface CrsFacts {
  /** The authority of `code` ("EPSG", "OGC"); EPSG when absent. */
  org?: string | null | undefined;
  /** The CRS code, when the file names one. */
  code?: number | string | null | undefined;
  /** `[west, south, east, north]`, when the file records its extent. */
  envelope?: readonly number[] | undefined;
}

/**
 * Whether a file's coordinates are longitude/latitude, by the rule in the
 * module description.
 */
export function isLonLatCrs(facts: CrsFacts): boolean {
  const env = facts.envelope;
  if (env && env.length >= 4 && !withinLonLat(env)) return false;
  const org = String(facts.org ?? "EPSG").toUpperCase();
  if (org === "OGC" && /^CRS(84|83|27)H?$/i.test(String(facts.code ?? ""))) return true;
  const code = typeof facts.code === "string" ? Number(facts.code) : facts.code;
  if (code && Number.isFinite(code) && org === "EPSG") {
    if (isGeographicCode(code)) return true;
    if (isKnownProjected(code)) return false;
  }
  return true;
}
