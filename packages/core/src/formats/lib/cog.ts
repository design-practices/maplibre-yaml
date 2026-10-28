/**
 * @file The COG library and adapter as the `cog` on-demand chunk sees it (0.9, ml-cnv.2; bundle headroom U5)
 * @module @maplibre-yaml/core/formats/lib/cog
 *
 * @description
 * The `cog://` protocol of `@geomatico/maplibre-cog-protocol` (which reads
 * with geotiff.js), core's own dependency-free GeoTIFF header reader, and
 * the adapter that turns a `cog://` request into a preflight read and a
 * plugin call (./cog-reader) — so none of it sits in the main bundle. What
 * the adapter uses of core is handed in ({@link useHost}); these modules
 * import core as types only (see the seam, formats/decoders.ts).
 */

export { cogProtocol } from "@geomatico/maplibre-cog-protocol";
export { isCloudOptimized, readCogHeader, readCogHeaderParts } from "../cog-header";
export { dropFirstBlock, shareFirstBlock } from "./cog-first-block";
export { classifyCogError, handle, preflight, useHost } from "./cog-reader";
