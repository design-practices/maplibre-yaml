/**
 * @file What a large FlatGeobuf or GeoParquet read costs, and how far an
 * author can safely raise `maxFeatures` (0.9.2)
 * @module @maplibre-yaml/core/formats/large-data
 *
 * @description
 * The size notices and author hints may tell an author to raise
 * `load: { maxFeatures }`. That is only advice worth giving while the raised
 * read stays usable: on NYC PLUTO (856,687 parcels), following a hint that
 * raised it to 900,000 loaded the whole city — 26 s, 4.3 GB and a 10.6 s
 * freeze on a desktop, 104 s and a 36.6 s freeze on a laptop profile — and
 * 800,000 by view on the FlatGeobuf file used 5.1 GB, ran at 6 fps and
 * re-downloaded 1.18 GB per pan (PR #206 verification, 2026-10-26). So a
 * raise is offered only up to the ceilings below, with its cost; past them
 * the hints point to PMTiles, reading by view or fewer `columns:` instead.
 *
 * Side-effect free (the message catalogue and the renderer both use it).
 */

/**
 * The most features a hint will suggest loading whole by raising
 * `maxFeatures`: 1.5 × the whole-file limit (400,000).
 *
 * @remarks
 * Measured whole reads of PLUTO parcels (Chromium, desktop with a GPU):
 * Brooklyn's 275,628 parcels took 2.3–2.5 GB of renderer memory and panned at
 * 50 fps; the citywide 856,687 took 4.3 GB, 26 s and froze the page for
 * 10.6 s. 600,000 parcels is about 3.5 GB by the model in
 * {@link memoryEstimateGB}: heavy, still short of the freeze.
 */
export const SAFE_WHOLE_FILE_FEATURES = 600_000;

/**
 * The most features in one view a hint will suggest reading by raising
 * `maxFeatures`.
 *
 * @remarks
 * Measured by-view reads of PLUTO: about 148,000 parcels in view (GeoParquet,
 * 10,000-row groups) took 2.9 GB and panned at 25 fps; about 268,000 took
 * 3.3 GB at 12 fps and re-read 441 MB per pan (FlatGeobuf), 3.9 GB at 16 fps
 * (GeoParquet); 800,000 took 5.1 GB at 6 fps. Past 250,000 every pan costs
 * seconds, so no hint goes there.
 */
export const SAFE_VIEW_FEATURES = 250_000;

/**
 * About how much browser memory drawing `features` parcel-like polygons
 * takes, in GB, rounded up to the next half: a straight line through the
 * measurements above (whole: 2.45 GB at 275,628, 4.3 GB at 856,687; by view:
 * 2.9 GB at 148,000, 3.3 GB at 268,000). Points and simple shapes take less;
 * the hints say so.
 */
export function memoryEstimateGB(features: number, byView: boolean): number {
  const gb = byView ? 2.2 + features * 4.5e-6 : 1.6 + features * 3.1e-6;
  return Math.ceil(gb * 2) / 2;
}

/** The next round 10,000 above `count`, with 5% of room (what a hint suggests). */
export function roundedRaise(count: number): number {
  return Math.max(10_000, Math.ceil((count * 1.05) / 10_000) * 10_000);
}
