/**
 * Hand-built PNG files for the grid reader's tests: any IHDR (bit depth,
 * color type, interlace flag), raw scanlines compressed with Node's zlib,
 * real CRCs (so pngjs reads them too). pngjs writes only the shapes it
 * supports; the reader's rejections need the others.
 */
import { deflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
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

export interface PngSpec {
  width: number;
  height: number;
  /** 0 gray, 2 RGB, 3 palette, 4 gray+alpha, 6 RGBA. */
  colorType: number;
  bitDepth?: number;
  interlace?: number;
  /**
   * Raw scanlines, each `filterByte` then the filtered bytes (default filter
   * 0: the pixel bytes as they are). Absent: no IDAT at all (a header-only
   * file, for size guards that must fail before inflating).
   */
  scanlines?: Uint8Array[];
  /** A PLTE chunk's RGB triples (palette images). */
  palette?: Uint8Array;
  /** IDAT split into this many chunks (default 1). */
  idatChunks?: number;
}

/** A PNG file from its parts. */
export function buildPng(spec: PngSpec): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, spec.width);
  v.setUint32(4, spec.height);
  ihdr[8] = spec.bitDepth ?? 8;
  ihdr[9] = spec.colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = spec.interlace ?? 0;
  const parts: Uint8Array[] = [SIGNATURE, chunk("IHDR", ihdr)];
  if (spec.palette) parts.push(chunk("PLTE", spec.palette));
  if (spec.scanlines) {
    const raw = concat(spec.scanlines);
    const deflated = new Uint8Array(deflateSync(raw));
    const n = spec.idatChunks ?? 1;
    const per = Math.ceil(deflated.length / n);
    for (let i = 0; i < n; i++) parts.push(chunk("IDAT", deflated.subarray(i * per, Math.min(deflated.length, (i + 1) * per))));
  }
  parts.push(chunk("IEND", new Uint8Array(0)));
  return concat(parts);
}

/** Unfiltered scanlines (filter byte 0) from row-major interleaved pixel bytes. */
export function plainScanlines(pixels: Uint8Array, width: number, height: number, channels: number): Uint8Array[] {
  const stride = width * channels;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(1 + stride);
    row.set(pixels.subarray(y * stride, (y + 1) * stride), 1);
    rows.push(row);
  }
  return rows;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
