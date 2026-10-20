/**
 * @file The COG library as the `cog` on-demand chunk sees it (0.9, ml-cnv.2)
 * @module @maplibre-yaml/core/formats/lib/cog
 *
 * @description
 * The `cog://` protocol of `@geomatico/maplibre-cog-protocol` (which reads
 * with geotiff.js), and core's own dependency-free GeoTIFF header reader,
 * which only formats/cog.ts uses — so it travels in the chunk instead of the
 * main bundle. A leaf module: it imports nothing else from core (see the
 * seam, formats/decoders.ts).
 */

export { cogProtocol } from "@geomatico/maplibre-cog-protocol";
export { isCloudOptimized, readCogHeader, readCogHeaderParts } from "../cog-header";
