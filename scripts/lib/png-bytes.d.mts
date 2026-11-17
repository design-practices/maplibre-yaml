/**
 * Types for `png-bytes.mjs` (TypeScript pairs a `.mjs` module with a
 * `.d.mts` declaration). The module itself is plain ESM so e2e/server.mjs
 * can import it; this file gives the TypeScript tests the same surface.
 */

/** The eight-byte PNG signature. */
export declare const SIGNATURE: Uint8Array;

/** CRC-32 (the PNG / zlib polynomial) of `bytes`, as an unsigned integer. */
export declare function crc32(bytes: Uint8Array): number;

/** One PNG chunk: big-endian length, four-character type, data, CRC over type and data. */
export declare function pngChunk(type: string, data: Uint8Array): Uint8Array;

export interface PngSpec {
  width: number;
  height: number;
  /** 0 gray, 2 RGB, 3 palette, 4 gray+alpha, 6 RGBA. */
  colorType: number;
  /** Default 8. */
  bitDepth?: number;
  /** Default 0 (none); 1 is Adam7. */
  interlace?: number;
  /**
   * Raw scanlines, each `filterByte` then the filtered bytes (filter 0: the
   * pixel bytes as they are). Absent, with no `idat`: no IDAT at all — a
   * header-only file, for size guards that must fail before inflating.
   */
  scanlines?: Uint8Array[];
  /**
   * The IDAT payload as given, instead of deflated `scanlines`: a zlib stream
   * built by the caller (one that inflates to far more than the image needs),
   * or bytes that aren't zlib at all.
   */
  idat?: Uint8Array;
  /** A PLTE chunk's RGB triples (palette images). */
  palette?: Uint8Array;
  /** IDAT split into this many chunks (default 1). */
  idatChunks?: number;
}

/** A PNG file from its parts: signature, IHDR, PLTE if given, IDAT(s) if there is image data, IEND. */
export declare function buildPng(spec: PngSpec): Uint8Array;

/** Unfiltered scanlines (filter byte 0) from row-major interleaved pixel bytes. */
export declare function plainScanlines(pixels: Uint8Array, width: number, height: number, channels: number): Uint8Array[];

/** The bytes of `parts`, one after another. */
export declare function concat(parts: Uint8Array[]): Uint8Array;
