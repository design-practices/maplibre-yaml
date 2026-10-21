/**
 * Types for the hyparquet-compressors files the GeoParquet reader imports
 * one by one (the package's index pulls in a WebAssembly snappy decoder the
 * reader doesn't need; hyparquet decodes snappy itself).
 */
declare module "hyparquet-compressors/src/gzip.js" {
  export function gunzip(input: Uint8Array, output: Uint8Array, inputIndex?: number, outputIndex?: number): Uint8Array;
}
declare module "hyparquet-compressors/src/lz4.js" {
  export function decompressLz4(input: Uint8Array, outputLength: number): Uint8Array;
  export function decompressLz4Raw(input: Uint8Array, outputLength: number): Uint8Array;
}
declare module "hyparquet-compressors/src/brotli.js" {
  export function decompressBrotli(input: Uint8Array, outputLength: number): Uint8Array;
}
