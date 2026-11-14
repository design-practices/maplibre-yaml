/**
 * @file A value-exact PNG reader for grid images, in the `grid` chunk (grid source, U2)
 * @module @maplibre-yaml/core/formats/lib/png
 *
 * @description
 * A grid image's bytes *are* the data: byte 137 in the red channel means a
 * particular value, not a colour. A canvas can't be trusted with that — it
 * un-premultiplies alpha and applies colour management when a file carries
 * gamma or ICC chunks — so the grid reader inflates and unfilters the file
 * itself: the chunks are walked, the `IDAT` payloads concatenated and
 * inflated with fflate, and the five scanline filters reversed. The result
 * is the file's own channel bytes, row-major, interleaved, and the same in
 * Node (where the tests check it against pngjs) as in a browser.
 *
 * Scope: 8-bit, non-interlaced grayscale, grayscale with alpha, RGB and
 * RGBA. Everything else — 16-bit, palette, 1/2/4-bit, interlaced — is
 * refused with a {@link PngError} that names what the file is, so the
 * notice can say what to write instead. This module imports core nothing:
 * it travels in the chunk with fflate.
 */

import { unzlibSync } from "fflate";

/** What a PNG's `IHDR` says. */
export interface PngHeader {
  width: number;
  height: number;
  /** Bits per channel (1, 2, 4, 8 or 16). */
  bitDepth: number;
  /** 0 grayscale, 2 RGB, 3 palette, 4 grayscale with alpha, 6 RGBA. */
  colorType: number;
  interlaced: boolean;
  /** Channels per pixel for the colour type (a palette index counts as one). */
  channels: number;
}

/** The colour types' everyday names, for messages. */
const COLOR_TYPE_NAMES: Record<number, string> = {
  0: "grayscale",
  2: "RGB",
  3: "palette",
  4: "grayscale with alpha",
  6: "RGBA",
};

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** The shape a refused image has (worded by the message catalogue, in the main bundle). */
export interface PngImageShape {
  bitDepth: number;
  colorType: string;
  interlaced: boolean;
}

/** Why bytes couldn't be decoded as a grid image. */
export class PngError extends Error {
  readonly reason: "not-png" | "unsupported" | "corrupt";
  /** `unsupported`: what the image is. */
  readonly image: PngImageShape | undefined;

  constructor(reason: "not-png" | "unsupported" | "corrupt", detail: string, image?: PngImageShape) {
    super(detail);
    this.name = "PngError";
    this.reason = reason;
    this.image = image;
  }
}

/** The eight signature bytes every PNG starts with. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A chunk type's four ASCII bytes as a number: "IHDR", "IDAT", "IEND". */
const IHDR = 0x49484452;
const IDAT = 0x49444154;
const IEND = 0x49454e44;

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

/**
 * The `IHDR` of a PNG, read before anything is inflated (the size guard
 * reads it), or `"not-png"` for bytes that aren't a PNG file.
 */
export function readPngHeader(bytes: Uint8Array): PngHeader | "not-png" {
  // Signature, then the IHDR chunk: length 13, type, 13 bytes, CRC.
  if (bytes.length < 33) return "not-png";
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return "not-png";
  if (u32(bytes, 8) !== 13 || u32(bytes, 12) !== IHDR) return "not-png";
  const colorType = bytes[25]!;
  return {
    width: u32(bytes, 16),
    height: u32(bytes, 20),
    bitDepth: bytes[24]!,
    colorType,
    interlaced: bytes[28] !== 0,
    channels: CHANNELS[colorType] ?? 1,
  };
}

/** An image the reader decodes: the header's channel bytes, row-major and interleaved. */
export interface PngImage {
  width: number;
  height: number;
  channels: number;
  /** `width * height * channels` bytes, as the file stores them. */
  data: Uint8Array;
}

/**
 * Decode a PNG's channel bytes exactly.
 *
 * @throws {PngError} `not-png` for other bytes; `unsupported` for a shape
 *   this reader doesn't decode (names it); `corrupt` for a PNG whose data
 *   doesn't fill its rows, won't inflate, or names a filter that doesn't exist.
 */
export function decodePng(bytes: Uint8Array): PngImage {
  const header = readPngHeader(bytes);
  if (header === "not-png") throw new PngError("not-png", "the bytes are not a PNG file");
  const { width, height, bitDepth, colorType, interlaced, channels } = header;
  const known = colorType in COLOR_TYPE_NAMES;
  if (!known || colorType === 3 || bitDepth !== 8 || interlaced) {
    throw new PngError("unsupported", `${bitDepth}-bit ${COLOR_TYPE_NAMES[colorType] ?? `color type ${colorType}`}${interlaced ? ", interlaced" : ""}`, {
      bitDepth,
      colorType: COLOR_TYPE_NAMES[colorType] ?? `type ${colorType}`,
      interlaced,
    });
  }
  if (width === 0 || height === 0) throw new PngError("corrupt", "the IHDR gives an empty image");

  // The IDAT payloads, in order, up to IEND.
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let at = 33; at + 12 <= bytes.length; ) {
    const length = u32(bytes, at);
    const type = u32(bytes, at + 4);
    const end = at + 12 + length;
    if (end > bytes.length) throw new PngError("corrupt", "the file ends inside a chunk");
    if (type === IDAT) {
      parts.push(bytes.subarray(at + 8, at + 8 + length));
      total += length;
    } else if (type === IEND) {
      break;
    }
    at = end;
  }
  if (total === 0) throw new PngError("corrupt", "the file has no image data (no IDAT chunk)");
  let deflated: Uint8Array;
  if (parts.length === 1) {
    deflated = parts[0]!;
  } else {
    deflated = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      deflated.set(part, offset);
      offset += part.length;
    }
  }

  const stride = width * channels;
  const expected = height * (stride + 1);
  let inflated: Uint8Array;
  try {
    inflated = unzlibSync(deflated);
  } catch (error) {
    throw new PngError("corrupt", `the image data won't inflate (${String((error as Error).message ?? error)})`);
  }
  if (inflated.length < expected) {
    throw new PngError("corrupt", `the inflated image data (${inflated.length} bytes) is shorter than its scanlines need (${expected})`);
  }

  // Reverse each scanline's filter (PNG spec 9.2); bpp is the channel count at 8 bits.
  const data = new Uint8Array(width * height * channels);
  const bpp = channels;
  let inAt = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[inAt++]!;
    const out = y * stride;
    const prev = out - stride;
    switch (filter) {
      case 0:
        data.set(inflated.subarray(inAt, inAt + stride), out);
        break;
      case 1:
        for (let i = 0; i < stride; i++) {
          data[out + i] = (inflated[inAt + i]! + (i >= bpp ? data[out + i - bpp]! : 0)) & 0xff;
        }
        break;
      case 2:
        if (y === 0) data.set(inflated.subarray(inAt, inAt + stride), out);
        else for (let i = 0; i < stride; i++) data[out + i] = (inflated[inAt + i]! + data[prev + i]!) & 0xff;
        break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? data[out + i - bpp]! : 0;
          const up = y > 0 ? data[prev + i]! : 0;
          data[out + i] = (inflated[inAt + i]! + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? data[out + i - bpp]! : 0;
          const b = y > 0 ? data[prev + i]! : 0;
          const c = y > 0 && i >= bpp ? data[prev + i - bpp]! : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          data[out + i] = (inflated[inAt + i]! + predictor) & 0xff;
        }
        break;
      default:
        throw new PngError("corrupt", `scanline ${y} names filter type ${filter}; PNG has 0 to 4`);
    }
    inAt += stride;
  }
  return { width, height, channels, data };
}
