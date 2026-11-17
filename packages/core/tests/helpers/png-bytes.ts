/**
 * Hand-built PNG files for the grid reader's tests: any IHDR (bit depth,
 * color type, interlace flag), raw scanlines compressed with Node's zlib,
 * real CRCs (so pngjs reads them too). pngjs writes only the shapes it
 * supports; the reader's rejections need the others.
 *
 * The implementation is the repo-wide one in scripts/lib/png-bytes.mjs,
 * which the hermetic e2e server (e2e/server.mjs) also builds its served
 * fixtures from; this module re-exports it so the tests keep one import.
 */
export { buildPng, concat, crc32, plainScanlines, pngChunk, SIGNATURE } from "../../../../scripts/lib/png-bytes.mjs";
export type { PngSpec } from "../../../../scripts/lib/png-bytes.mjs";
