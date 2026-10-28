/**
 * @file Stand-in for `@bokuweb/zstd-wasm` in the CDN/browser build (ml-aot.109)
 * @module @maplibre-yaml/core/formats/zstd-unavailable
 *
 * @description
 * flatgeobuf's seekable-Zstandard reader imports `@bokuweb/zstd-wasm` on
 * demand. A plain CDN page has no import-map entry for it, so the bare
 * specifier would fail as an opaque module-resolution error; and the codec
 * also needs its `.wasm` served next to the script, which a CDN build cannot
 * promise. maplibre-yaml never asks the reader for that mode (compressed
 * files are recognized and refused with a plain notice, see
 * formats/lib/flatgeobuf), so in the browser build the import resolves here and
 * fails plainly if anything ever reaches it. Bundler builds (Vite, Astro)
 * keep the real dependency.
 */

const unavailable = (): never => {
  throw new Error(
    "Compressed (Zstandard) FlatGeobuf files aren't supported in this build: write the file uncompressed."
  );
};

export const init = async (): Promise<never> => unavailable();
export const decompress = unavailable;
