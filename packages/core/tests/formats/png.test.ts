// @vitest-environment node
/**
 * The grid chunk's PNG reader (grid source, U2): value-exact 8-bit decoding
 * — grayscale, gray+alpha, RGB, RGBA, every scanline filter — checked byte
 * for byte against pngjs, and a named refusal for every other PNG shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { buildPng, plainScanlines } from "../helpers/png-bytes";
import { decodePng, readPngHeader } from "../../src/formats/lib/png";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples/verification/null-earth/data");
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** Deterministic pixel bytes. */
function pixels(width: number, height: number, channels: number): Uint8Array {
  const out = new Uint8Array(width * height * channels);
  for (let i = 0; i < out.length; i++) out[i] = (i * 37 + (i >> 3) * 11) & 0xff;
  return out;
}

/** pngjs's RGBA expansion of `data` with `channels`, for comparing. */
function viaPngjs(file: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const png = PNG.sync.read(Buffer.from(file));
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}

/** Our channel bytes expanded to RGBA the way pngjs does it (gray → r=g=b, opaque when no alpha). */
function toRgba(data: Uint8Array, channels: number): Uint8Array {
  const n = data.length / channels;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * channels;
    if (channels === 1) out.set([data[p]!, data[p]!, data[p]!, 255], i * 4);
    else if (channels === 2) out.set([data[p]!, data[p]!, data[p]!, data[p + 1]!], i * 4);
    else if (channels === 3) out.set([data[p]!, data[p + 1]!, data[p + 2]!, 255], i * 4);
    else out.set(data.subarray(p, p + 4), i * 4);
  }
  return out;
}

describe("readPngHeader", () => {
  it("reads the IHDR of the committed frames", () => {
    expect(readPngHeader(fixture("2026111400-f000-wind-10m.png"))).toEqual({
      width: 360,
      height: 181,
      bitDepth: 8,
      colorType: 6,
      interlaced: false,
      channels: 4,
    });
    expect(readPngHeader(fixture("2026111400-f000-temp-2m.png"))).toMatchObject({ colorType: 2, channels: 3 });
  });

  it("is 'not-png' for other bytes: JPEG, text, an empty file, a truncated signature", () => {
    expect(readPngHeader(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46))).toBe("not-png");
    expect(readPngHeader(new TextEncoder().encode("<!doctype html><html></html>"))).toBe("not-png");
    expect(readPngHeader(new Uint8Array(0))).toBe("not-png");
    expect(readPngHeader(fixture("2026111400-f000-wind-10m.png").subarray(0, 12))).toBe("not-png");
  });
});

describe("decodePng — value-exact, against pngjs", () => {
  const shapes: [name: string, colorType: number, channels: number][] = [
    ["grayscale", 0, 1],
    ["gray+alpha", 4, 2],
    ["RGB", 2, 3],
    ["RGBA", 6, 4],
  ];
  for (const [name, colorType, channels] of shapes) {
    it(`${name}, unfiltered, in several IDAT chunks`, () => {
      const data = pixels(7, 5, channels);
      const file = buildPng({ width: 7, height: 5, colorType, scanlines: plainScanlines(data, 7, 5, channels), idatChunks: 3 });
      const decoded = decodePng(file);
      expect(decoded).toMatchObject({ width: 7, height: 5, channels });
      expect(decoded.data).toEqual(data);
      expect(toRgba(decoded.data, channels)).toEqual(viaPngjs(file).rgba);
    });
  }

  for (const filter of [0, 1, 2, 3, 4]) {
    it(`reverses scanline filter ${filter} (pngjs-written RGBA and RGB)`, () => {
      for (const [colorType, channels] of [[6, 4], [2, 3]] as const) {
        const width = 9;
        const height = 6;
        const rgba = pixels(width, height, 4);
        const file = new Uint8Array(
          PNG.sync.write(Object.assign(new PNG({ width, height }), { data: Buffer.from(rgba) }), { colorType, filterType: filter })
        );
        const decoded = decodePng(file);
        expect(decoded.channels).toBe(channels);
        expect(toRgba(decoded.data, channels)).toEqual(viaPngjs(file).rgba);
      }
    });
  }

  it("the committed wind frame (RGBA) and temperature frame (RGB), byte for byte", () => {
    for (const name of ["2026111400-f000-wind-10m.png", "2026111400-f000-temp-2m.png"]) {
      const file = fixture(name);
      const decoded = decodePng(file);
      const oracle = viaPngjs(file);
      expect([decoded.width, decoded.height]).toEqual([oracle.width, oracle.height]);
      expect(toRgba(decoded.data, decoded.channels)).toEqual(oracle.rgba);
    }
  });

  it("refuses 16-bit, palette, interlaced and sub-byte images, naming what they are", () => {
    const sixteen = buildPng({ width: 2, height: 1, colorType: 2, bitDepth: 16, scanlines: [new Uint8Array(13)] });
    expect(() => decodePng(sixteen)).toThrow(expect.objectContaining({ reason: "unsupported", image: { bitDepth: 16, colorType: "RGB", interlaced: false } }));
    const palette = buildPng({ width: 2, height: 1, colorType: 3, palette: Uint8Array.of(0, 0, 0, 255, 255, 255), scanlines: [Uint8Array.of(0, 0, 1)] });
    expect(() => decodePng(palette)).toThrow(expect.objectContaining({ reason: "unsupported", image: { bitDepth: 8, colorType: "palette", interlaced: false } }));
    const interlaced = buildPng({ width: 2, height: 1, colorType: 6, interlace: 1, scanlines: [new Uint8Array(9)] });
    expect(() => decodePng(interlaced)).toThrow(expect.objectContaining({ reason: "unsupported", image: { bitDepth: 8, colorType: "RGBA", interlaced: true } }));
    const oneBit = buildPng({ width: 8, height: 1, colorType: 0, bitDepth: 1, scanlines: [Uint8Array.of(0, 0b10101010)] });
    expect(() => decodePng(oneBit)).toThrow(expect.objectContaining({ reason: "unsupported", image: { bitDepth: 1, colorType: "grayscale", interlaced: false } }));
  });

  it("is 'not-png' for other bytes, and 'corrupt' for a PNG whose data doesn't fill its rows", () => {
    expect(() => decodePng(new TextEncoder().encode("not a png"))).toThrow(expect.objectContaining({ reason: "not-png" }));
    const short = buildPng({ width: 4, height: 3, colorType: 6, scanlines: [new Uint8Array(17), new Uint8Array(17)] }); // 2 of 3 rows
    expect(() => decodePng(short)).toThrow(expect.objectContaining({ reason: "corrupt" }));
    const headerOnly = buildPng({ width: 4, height: 3, colorType: 6 });
    expect(() => decodePng(headerOnly)).toThrow(expect.objectContaining({ reason: "corrupt" }));
    const badFilter = buildPng({ width: 1, height: 1, colorType: 0, scanlines: [Uint8Array.of(7, 1)] });
    expect(() => decodePng(badFilter)).toThrow(expect.objectContaining({ reason: "corrupt" }));
  });
});
