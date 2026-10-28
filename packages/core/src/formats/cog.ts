/**
 * @file COG: the `cog://` request URL, as the main bundle and the reader see it (0.9, ml-cnv.2)
 * @module @maplibre-yaml/core/formats/cog
 *
 * @description
 * A Cloud Optimized GeoTIFF is one image file read with HTTP range requests.
 * What the `cog://` protocol does with a request — the preflight read of the
 * file's first 64 KB, the plugin, every failure in plain words — is in the
 * `cog` chunk (formats/lib/cog-reader.ts, bundle headroom U5), reached
 * through formats/cog-protocol.ts. This leaf holds what both sides use:
 * where the file is inside a request URL (`<ml-map>` frames a `fitTo` COG
 * by it, before the map is built) and how much the preflight reads.
 *
 * A leaf: it imports nothing, so the chunk carries its own copy.
 */

/** How much of the file the preflight reads: any COG's header fits. */
export const HEADER_BYTES = 65536;

/** A request MapLibre sends a protocol handler (the fields used here). */
export interface CogRequest {
  url: string;
  type?: string;
}

/** Called once per file that draws but isn't cloud-optimized: the hint to show. */
export type CogHintReporter = (fileUrl: string, message: string) => void;

/** The file URL inside a `cog://` request (scheme, fragment and tile suffix dropped). */
export function fileUrlOf(requestUrl: string): string {
  const inner = requestUrl.replace(/^cog:\/\//i, "");
  const hash = inner.indexOf("#");
  const file = hash === -1 ? inner : inner.slice(0, hash);
  return file.replace(/\/\d+\/\d+\/\d+$/, "");
}
