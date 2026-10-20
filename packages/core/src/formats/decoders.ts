/**
 * @file The one seam every cloud-native decoder is reached through
 * @module @maplibre-yaml/core/formats/decoders
 *
 * @description
 * In 0.9 the decoders are bundled into core (pmtiles ~7.4 KB gz, flatgeobuf
 * ~10 KB gz): no build-system change before the classroom starts. Lazy
 * loading (ml-7qa.5) is deferred, and this seam is what makes it a local
 * change later: every caller already awaits {@link getDecoder}, so each
 * entry below can become `() => import("./pmtiles")` — an on-demand chunk —
 * without touching a single call site, and a page that uses no
 * cloud-native format would then download none of it.
 *
 * Decoders never import maplibre-gl: what they need from it is injected by
 * the caller (`install({ addProtocol, config, … })`), so a future chunk
 * cannot pull in a second maplibre-gl.
 */

import * as pmtiles from "./pmtiles";
import * as flatgeobuf from "./flatgeobuf";
import type { CloudFormat } from "./detect";

/** The decoder module for each format this version reads. */
export interface Decoders {
  pmtiles: typeof pmtiles;
  flatgeobuf: typeof flatgeobuf;
}

/** The formats {@link getDecoder} can return a module for. */
export type DecodedFormat = keyof Decoders;

const BUNDLED: Decoders = { pmtiles, flatgeobuf };

/**
 * The decoder module for `format`.
 *
 * @remarks
 * Always a promise, though it resolves at once in 0.9: callers written
 * against the promise keep working when the module behind it is fetched on
 * demand.
 */
export function getDecoder<F extends DecodedFormat>(format: F): Promise<Decoders[F]> {
  return Promise.resolve(BUNDLED[format]);
}

/** Whether this version has a decoder for `format`. */
export function hasDecoder(format: CloudFormat): format is DecodedFormat {
  return format === "pmtiles" || format === "flatgeobuf";
}
