/**
 * @file Whole-file GeoTIFF bands as typed arrays, in the `cog` chunk (grid source, U2)
 * @module @maplibre-yaml/core/formats/lib/geotiff-bands
 *
 * @description
 * A grid source with `encoding: geotiff` reads one or two bands of a
 * GeoTIFF already downloaded whole. The COG chunk bundles geotiff.js for
 * the `cog://` protocol; this reader sits beside it so one copy serves
 * both, and the grid chunk reaches it through its host's decoder seam
 * (`host.getDecoder("cog")`). It reads on the main thread (no worker pool:
 * a grid is decoded once, not tile by tile) and returns the facts the grid
 * chunk decides with — size, bands, bounds, EPSG code, nodata — leaving the
 * grid's own rules (EPSG:4326 only, the cell cap, the failure wording) to
 * the grid chunk. Imports core nothing.
 */

import { fromArrayBuffer } from "geotiff";

/** What {@link readBands} found. */
export interface GeoTiffBands {
  width: number;
  height: number;
  /** One array per requested band, row-major from the north-west pixel, `width * height` long. */
  bands: Float32Array[];
  /** The image's extent in its own units, `[west, south, east, north]`, when georeferenced. */
  bounds: [number, number, number, number] | undefined;
  /** The EPSG code the GeoKeys name (projected, else geographic), when they name one. */
  epsg: number | undefined;
  /** The `GDAL_NODATA` tag's value, when the file carries one. */
  nodata: number | undefined;
}

/** A finite number, or undefined (GeoKeys may hold `undefined`, strings or 32767 "user-defined"). */
function epsgOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value !== 32767 ? value : undefined;
}

/**
 * Read `bands` (indices; `[0]` by default) of the first image in a GeoTIFF.
 *
 * @throws {RangeError} For a band index the file doesn't have (the message
 *   names the index and the file's band count). Anything else geotiff.js
 *   throws passes through (the caller classifies).
 */
export async function readBands(bytes: ArrayBuffer, bands?: readonly number[]): Promise<GeoTiffBands> {
  const tiff = await fromArrayBuffer(bytes);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const count = image.getSamplesPerPixel();
  const samples = bands ? [...bands] : [0];
  for (const band of samples) {
    if (!Number.isInteger(band) || band < 0 || band >= count) {
      throw new RangeError(`band ${band} is not in the file: it has ${count} band${count === 1 ? "" : "s"} (0 to ${count - 1})`);
    }
  }
  const rasters = (await image.readRasters({ samples, interleave: false })) as ArrayLike<number>[];
  const out = rasters.map((raster) => (raster instanceof Float32Array ? raster : Float32Array.from(raster)));
  let bounds: GeoTiffBands["bounds"];
  try {
    const [w, s, e, n] = image.getBoundingBox() as number[];
    bounds = [w!, s!, e!, n!].every((v) => Number.isFinite(v)) ? [w!, s!, e!, n!] : undefined;
  } catch {
    bounds = undefined; // no tie point, scale or transformation
  }
  const keys = (image.getGeoKeys() ?? {}) as Record<string, unknown>;
  const epsg = epsgOf(keys["ProjectedCSTypeGeoKey"]) ?? epsgOf(keys["GeographicTypeGeoKey"]);
  const nodata = image.getGDALNoData();
  return { width, height, bands: out, bounds, epsg, nodata: nodata === null || !Number.isFinite(nodata) ? undefined : nodata };
}
