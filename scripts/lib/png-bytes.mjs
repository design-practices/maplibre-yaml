/**
 * Hand-built PNG files, shared by the hermetic e2e server (e2e/server.mjs)
 * and the grid reader's Node tests (packages/core/tests/helpers/png-bytes.ts).
 *
 * @remarks
 * Any IHDR (bit depth, color type, interlace flag), raw scanlines compressed
 * with Node's zlib, real CRCs — so pngjs and browsers read the valid shapes,
 * and the reader's rejections (16-bit, interlaced, palette, header-only,
 * short, inflate bombs) get the invalid ones. pngjs writes only the shapes it
 * supports, and the repo commits no binary fixtures, so both consumers build
 * what they serve or feed. Plain ESM with no TypeScript so the server can
 * import it; types live in the sibling `png-bytes.d.mts`.
 *
 * Everything takes and returns `Uint8Array`; a Node `Buffer` is one, so the
 * server passes its buffers straight in and wraps the result where it needs
 * `Buffer.isBuffer` to hold.
 */
import { deflateSync } from "node:zlib";

/** The eight-byte PNG signature. */
export const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** @type {Uint32Array | undefined} */
let crcTable;

/**
 * CRC-32 (the PNG / zlib polynomial) of `bytes`, as an unsigned integer.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = /** @type {number} */ (crcTable[(crc ^ b) & 0xff]) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * One PNG chunk: big-endian length, four-character type, data, CRC over
 * type and data.
 * @param {string} type
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/**
 * @typedef {object} PngSpec
 * @property {number} width
 * @property {number} height
 * @property {number} colorType  0 gray, 2 RGB, 3 palette, 4 gray+alpha, 6 RGBA.
 * @property {number} [bitDepth]  Default 8.
 * @property {number} [interlace]  Default 0 (none); 1 is Adam7.
 * @property {Uint8Array[]} [scanlines]
 *   Raw scanlines, each `filterByte` then the filtered bytes (filter 0: the
 *   pixel bytes as they are). Absent, with no `idat`: no IDAT at all — a
 *   header-only file, for size guards that must fail before inflating.
 * @property {Uint8Array} [idat]
 *   The IDAT payload as given, instead of deflated `scanlines`: a zlib stream
 *   built by the caller (one that inflates to far more than the image needs),
 *   or bytes that aren't zlib at all.
 * @property {Uint8Array} [palette]  A PLTE chunk's RGB triples (palette images).
 * @property {number} [idatChunks]  IDAT split into this many chunks (default 1).
 */

/**
 * A PNG file from its parts: signature, IHDR, PLTE if given, IDAT(s) if
 * there is image data, IEND.
 * @param {PngSpec} spec
 * @returns {Uint8Array}
 */
export function buildPng(spec) {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, spec.width);
  v.setUint32(4, spec.height);
  ihdr[8] = spec.bitDepth ?? 8;
  ihdr[9] = spec.colorType;
  ihdr[10] = 0; // compression method: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = spec.interlace ?? 0;
  const parts = [SIGNATURE, pngChunk("IHDR", ihdr)];
  if (spec.palette) parts.push(pngChunk("PLTE", spec.palette));
  if (spec.scanlines || spec.idat) {
    const deflated = spec.idat ?? new Uint8Array(deflateSync(concat(/** @type {Uint8Array[]} */ (spec.scanlines))));
    const n = spec.idatChunks ?? 1;
    const per = Math.ceil(deflated.length / n);
    for (let i = 0; i < n; i++) {
      parts.push(pngChunk("IDAT", deflated.subarray(i * per, Math.min(deflated.length, (i + 1) * per))));
    }
  }
  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return concat(parts);
}

/**
 * Unfiltered scanlines (filter byte 0) from row-major interleaved pixel bytes.
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} channels  Bytes per pixel.
 * @returns {Uint8Array[]}
 */
export function plainScanlines(pixels, width, height, channels) {
  const stride = width * channels;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(1 + stride);
    row.set(pixels.subarray(y * stride, (y + 1) * stride), 1);
    rows.push(row);
  }
  return rows;
}

/**
 * The bytes of `parts`, one after another.
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
