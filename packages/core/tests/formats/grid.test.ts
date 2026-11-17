// @vitest-environment node
/**
 * The grid chunk (grid source, U2): bytes of every supported encoding
 * become a `GridField`, sampled bilinearly with wrap, clamp and missing-data
 * semantics fixed here on a synthetic 4 × 3 grid — then the committed 1°
 * frames (AE1, AE2), nullschool JSON, a GeoTIFF built in the test, and every
 * refusal in the plan's U2 list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { writeArrayBuffer } from "geotiff";
import { buildPng, plainScanlines } from "../helpers/png-bytes";
import type { GridSource } from "../../src/schemas/source.schema";
import type { GridField, GridHost, ScalarGridField, VectorGridField } from "../../src/renderer/grid-host";
import { formatError, isFormatError } from "../../src/formats/errors";
import { getDecoder } from "../../src/formats/decoders";
import { decodeGrid, GRID_MAX_CELLS } from "../../src/formats/lib/grid";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples/verification/null-earth/data");
const fixture = (name: string) => bytesOf(readFileSync(join(FIXTURES, name)));
const bytesOf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const host: GridHost = { formatError, getDecoder };
const URL = "data/field.png";

/** A spec with the keys the schema would have validated. */
const spec = (s: Partial<GridSource> & Pick<GridSource, "encoding">): GridSource => ({ type: "grid", url: URL, ...s });

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(isFormatError(error), String(error)).toBe(true);
  return error as Error & { failure: import("../../src/formats/errors").FormatFailure };
}

// ---------------------------------------------------------------------------
// The synthetic 4 × 3 grid: node (col, row) holds row * 10 + col.
// ---------------------------------------------------------------------------

const ROWS = [
  [0, 1, 2, 3],
  [10, 11, 12, 13],
  [20, 21, 22, 23],
];

/** A nullschool-style record: `header` plus a row-major `data` array. */
function record(header: Record<string, number>, data: (number | null)[]) {
  return { header, data };
}

/** One record of the 4 × 3 grid, `dx` wide columns from `lo1`, rows 10° apart from 10°N. */
function scalarJson(options: { lo1?: number; dx?: number; data?: (number | null)[]; nx?: number; extra?: Record<string, number> } = {}): ArrayBuffer {
  const nx = options.nx ?? 4;
  const header = { lo1: options.lo1 ?? 0, la1: 10, dx: options.dx ?? 90, dy: 10, nx, ny: 3, ...options.extra };
  const text = JSON.stringify([record(header, options.data ?? ROWS.flat())]);
  return bytesOf(new TextEncoder().encode(text));
}

const json = (s: Partial<GridSource> = {}) => spec({ encoding: "nullschool-json", url: "data/field.json", ...s });

describe("the sampler, on a synthetic wrapping 4 × 3 grid (nx * dx = 360)", () => {
  let field: ScalarGridField;
  const load = async () => (field ??= (await decodeGrid(scalarJson(), json(), host)) as ScalarGridField);

  it("exposes kind, geometry, bounds, wraps and counts", async () => {
    const f = await load();
    expect(f.kind).toBe("scalar");
    expect(f.units).toBeUndefined();
    expect([f.nx, f.ny]).toEqual([4, 3]);
    expect(f.grid).toEqual({ nx: 4, ny: 3, lo1: 0, la1: 10, dx: 90, dy: 10 });
    expect(f.bounds).toEqual([-45, -15, 315, 15]);
    expect(f.wraps).toBe(true);
    expect(f.range).toBeUndefined();
  });

  it("the value at a node is the node's value; both position shapes work", async () => {
    const f = await load();
    expect(f.sample({ lng: 90, lat: 0 })).toBe(11);
    expect(f.sample([90, 0])).toBe(11);
    expect(f.sample([0, 10])).toBe(0);
    expect(f.sample([270, -10])).toBe(23);
  });

  it("the midpoint between two nodes is their mean, in both axes", async () => {
    const f = await load();
    expect(f.sample([45, 10])).toBeCloseTo(0.5, 10);
    expect(f.sample([0, 5])).toBeCloseTo(5, 10);
    expect(f.sample([45, 5])).toBeCloseTo(5.5, 10);
  });

  it("latitude beyond the first or last row clamps to that row", async () => {
    const f = await load();
    expect(f.sample([0, 50])).toBe(0);
    expect(f.sample([0, 90])).toBe(0);
    expect(f.sample([90, -50])).toBe(21);
    expect(f.sample([90, -90])).toBe(21);
  });

  it("wraps in longitude: the seam blends the last and first columns, and any longitude works", async () => {
    const f = await load();
    expect(f.sample([315, 10])).toBeCloseTo(1.5, 10); // between col 3 (3) and col 0 (0)
    expect(f.sample([-45, 10])).toBeCloseTo(1.5, 10);
    expect(f.sample([675, 10])).toBeCloseTo(1.5, 10);
    expect(f.sample([-180, 0])).toBe(12); // col 2
    expect(f.sample([180, 0])).toBe(12);
    expect(f.sample([360, 0])).toBe(10);
  });

  it("values() materializes every node once, with an all-clear missing mask", async () => {
    const f = await load();
    const values = f.values();
    expect(Array.from(values.value)).toEqual(ROWS.flat());
    expect(Array.from(values.missing)).toEqual(new Array(12).fill(0));
    expect(f.values()).toBe(values);
    expect(f.isMissing(1, 1)).toBe(false);
  });

  it("a NaN or non-finite position samples to null", async () => {
    const f = await load();
    expect(f.sample([NaN, 0])).toBeNull();
    expect(f.sample([0, Infinity])).toBeNull();
  });

  it("contains: a wrapping grid is never left in longitude, latitude beyond a pole clamps and is still inside, a non-finite pair is not", async () => {
    const f = await load();
    expect(f.contains([90, 0])).toBe(true);
    expect(f.contains({ lng: -1000, lat: 0 })).toBe(true);
    expect(f.contains([0, 89.9])).toBe(true);
    expect(f.contains([0, -90])).toBe(true);
    expect(f.contains([NaN, 0])).toBe(false);
    expect(f.contains([0, Infinity])).toBe(false);
  });

  it("carries physical values: rescale is refused", async () => {
    const f = await load();
    expect(() => f.rescale([0, 1])).toThrow(/physical values|range/);
  });
});

describe("the sampler, on a non-wrapping 4 × 3 grid (40° wide from 0°E)", () => {
  const load = async () => (await decodeGrid(scalarJson({ dx: 10 }), json(), host)) as ScalarGridField;

  it("does not wrap: null one cell west of the first column and east of the last", async () => {
    const f = await load();
    expect(f.wraps).toBe(false);
    expect(f.bounds).toEqual([-5, -15, 35, 15]);
    expect(f.sample([-10, 10])).toBeNull();
    expect(f.sample([-0.001, 10])).toBeNull();
    expect(f.sample([0, 10])).toBe(0);
    expect(f.sample([30, 10])).toBe(3);
    expect(f.sample([30.001, 10])).toBeNull();
  });

  it("a longitude given beyond ±180 or on the 0..360 side is the same place", async () => {
    const f = await load();
    expect(f.sample([365, 10])).toBeCloseTo(0.5, 10);
    expect(f.sample([-355, 10])).toBeCloseTo(0.5, 10);
    expect(f.sample([355, 10])).toBeNull(); // -5°: half a cell west, outside
  });

  it("contains says exactly where sample would answer: outside west or east of the columns is false, on them true, whatever the turn of the globe", async () => {
    const f = await load();
    expect(f.contains([-10, 10])).toBe(false);
    expect(f.contains([-0.001, 10])).toBe(false);
    expect(f.contains([0, 10])).toBe(true);
    expect(f.contains([30, 10])).toBe(true);
    expect(f.contains([30.001, 10])).toBe(false);
    expect(f.contains([355, 10])).toBe(false);
    expect(f.contains([365, 10])).toBe(true);
    expect(f.contains([15, 80])).toBe(true); // above the first row: clamped, inside
  });
});

describe("missing data", () => {
  it("a null node makes every sample touching it null, and the mask marks it", async () => {
    const data = ROWS.flat();
    data[5] = null; // col 1, row 1
    const f = (await decodeGrid(scalarJson({ data }), json(), host)) as ScalarGridField;
    expect(f.isMissing(1, 1)).toBe(true);
    expect(f.sample([90, 0])).toBeNull(); // the node itself
    expect(f.sample([45, 5])).toBeNull(); // the cell to its north-west
    expect(f.sample([135, -5])).toBeNull(); // the cell to its south-east
    expect(f.sample([90, 5])).toBeNull(); // on its column, between rows
    expect(f.sample([100, 0])).toBeNull(); // on its row, between columns
    expect(f.sample([270, 0])).toBe(13); // nothing to do with it
    expect(f.sample([0, 10])).toBe(0);
    // A node beside it, sampled exactly: the missing node has no weight, so it doesn't contribute (R8).
    expect(f.sample([0, 0])).toBe(10);
    expect(f.sample([90, 10])).toBe(1);
    expect(f.sample([45, 10])).toBeCloseTo(0.5, 10); // the row above, between columns
    expect(f.values().missing[5]).toBe(1);
    expect(Number.isNaN(f.values().value[5]!)).toBe(true);
    // Missing is not outside: contains tells them apart.
    expect(f.contains([90, 0])).toBe(true);
    expect(f.sample([90, 0])).toBeNull();
  });

  it("alpha 0 marks a node missing in an RGBA image, and the declared nodata rule adds to it", async () => {
    const rgba = new Uint8Array(4 * 3 * 4);
    for (let i = 0; i < 12; i++) rgba.set([i * 20, 255 - i * 20, 100, 255], i * 4);
    rgba[1 * 4 + 3] = 0; // node (1, 0): transparent
    rgba[6 * 4 + 2] = 250; // node (2, 1): blue over the rule
    const file = buildPng({ width: 4, height: 3, colorType: 6, scanlines: plainScanlines(rgba, 4, 3, 4) });
    const image = spec({ encoding: "scalar-r", range: [0, 255], bounds: [-45, -15, 315, 15], nodata: { channel: "b", above: 200 } });
    const f = (await decodeGrid(bytesOf(file), image, host)) as ScalarGridField;
    expect(f.isMissing(1, 0)).toBe(true);
    expect(f.isMissing(2, 1)).toBe(true);
    expect(f.isMissing(0, 0)).toBe(false);
    expect(f.sample([90, 10])).toBeNull();
    expect(f.sample([180, 0])).toBeNull();
    expect(f.sample([0, 10])).toBe(0);
    expect(f.sample([270, -10])).toBe(11 * 20);
    expect(Array.from(f.values().missing)).toEqual([0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  });
});

describe("channel layouts (gray+alpha and RGB under the nodata rule)", () => {
  /** 4 × 3 gray+alpha: gray = row*10+col; alpha 255 except node (1, 0) at 100 and node (2, 1) at 0. */
  const ga = new Uint8Array(4 * 3 * 2);
  ROWS.flat().forEach((v, i) => ga.set([v, 255], i * 2));
  ga[1 * 2 + 1] = 100;
  ga[6 * 2 + 1] = 0;
  const gaFile = bytesOf(buildPng({ width: 4, height: 3, colorType: 4, scanlines: plainScanlines(ga, 4, 3, 2) }));
  const bounds = [-45, -15, 315, 15] as [number, number, number, number];

  it("a gray+alpha image under rg-uv is refused naming its 2 channels: its second channel is alpha, never v", async () => {
    const error = await failure(decodeGrid(gaFile, spec({ encoding: "rg-uv", range: [-1, 1], bounds }), host));
    expect(error.failure).toMatchObject({ code: "encoding", encoding: "rg-uv", image: { channels: 2 } });
    expect(error.message).toContain("2 channels");
    expect(error.message).toContain("RGB or RGBA");
  });

  it("a gray+alpha image under scalar-r reads channel 0, and `nodata: channel: a` reads its alpha (channel 1)", async () => {
    const f = (await decodeGrid(gaFile, spec({ encoding: "scalar-r", range: [0, 255], bounds, nodata: { channel: "a", below: 128 } }), host)) as ScalarGridField;
    expect(f.sample([0, 10])).toBe(0);
    expect(f.sample([270, -10])).toBe(23);
    expect(f.isMissing(1, 0)).toBe(true); // alpha 100: under the rule
    expect(f.isMissing(2, 1)).toBe(true); // alpha 0: the encoding's own marker
    expect(f.isMissing(3, 0)).toBe(false);
    expect(Array.from(f.values().missing)).toEqual([0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    // Without the rule, only alpha 0 marks.
    const plain = (await decodeGrid(gaFile, spec({ encoding: "scalar-r", range: [0, 255], bounds }), host)) as ScalarGridField;
    expect(plain.isMissing(1, 0)).toBe(false);
    expect(plain.isMissing(2, 1)).toBe(true);
  });

  it("a rule naming a channel the layout lacks is refused naming the rule and the channel count: `a` on RGB, `g` on grayscale", async () => {
    const rgb = new Uint8Array(4 * 3 * 3);
    ROWS.flat().forEach((v, i) => rgb.set([v, 0, 0], i * 3));
    const rgbFile = bytesOf(buildPng({ width: 4, height: 3, colorType: 2, scanlines: plainScanlines(rgb, 4, 3, 3) }));
    const error = await failure(decodeGrid(rgbFile, spec({ encoding: "scalar-r", range: [0, 255], bounds, nodata: { channel: "a", below: 128 } }), host));
    expect(error.failure).toMatchObject({ code: "encoding", format: "grid", image: { channels: 3 }, detail: "nodata: channel: a" });
    expect(error.message).toContain("3 channels");
    expect(error.message).toContain("`nodata: channel: a`");
    expect(error.message).not.toContain("rg-uv");
    // The same file with a rule on a channel it has reads fine.
    const ok = (await decodeGrid(rgbFile, spec({ encoding: "scalar-r", range: [0, 255], bounds, nodata: { channel: "b", above: 200 } }), host)) as ScalarGridField;
    expect(ok.sample([90, 0])).toBe(11);
    const gray = bytesOf(buildPng({ width: 4, height: 3, colorType: 0, scanlines: plainScanlines(new Uint8Array(12), 4, 3, 1) }));
    const g = await failure(decodeGrid(gray, spec({ encoding: "scalar-r", range: [0, 255], bounds, nodata: { channel: "g", equals: 0 } }), host));
    expect(g.failure).toMatchObject({ code: "encoding", image: { channels: 1 }, detail: "nodata: channel: g" });
    expect(g.message).toContain("1 channel");
  });
});

describe("a duplicated last column", () => {
  it("is detected as wrapping, and the seam reads through it", async () => {
    // Five columns 90° apart from 0°: the last (360°) repeats the first.
    const data = ROWS.map((row) => [...row, row[0]!]).flat();
    const f = (await decodeGrid(scalarJson({ nx: 5, data }), json(), host)) as ScalarGridField;
    expect(f.wraps).toBe(true);
    expect(f.nx).toBe(5);
    expect(f.sample([-45, 10])).toBeCloseTo(1.5, 10);
    expect(f.sample([315, 10])).toBeCloseTo(1.5, 10);
    expect(f.sample([360, 10])).toBe(0);
    expect(f.sample([-90, 0])).toBe(13);
  });
});

describe("byte encodings: rg-uv and scalar-r over an image", () => {
  /** 4 × 3 RGBA: red = row*10+col, green = 255 - red, blue 255, alpha 255. */
  const rgba = new Uint8Array(4 * 3 * 4);
  ROWS.flat().forEach((v, i) => rgba.set([v, 255 - v, 255, 255], i * 4));
  const file = bytesOf(buildPng({ width: 4, height: 3, colorType: 6, scanlines: plainScanlines(rgba, 4, 3, 4) }));
  const geometry = { nx: 4, ny: 3, lo1: 0, la1: 10, dx: 90, dy: 10 };

  it("scalar-r reads the red byte and unscales by range after blending", async () => {
    const f = (await decodeGrid(file, spec({ encoding: "scalar-r", range: [100, 355], grid: geometry, units: "K" }), host)) as ScalarGridField;
    expect(f.kind).toBe("scalar");
    expect(f.units).toBe("K");
    expect(f.range).toEqual([100, 355]);
    expect(f.sample([90, 0])).toBe(111); // byte 11 → 100 + 11
    expect(f.sample([45, 10])).toBeCloseTo(100.5, 10);
    expect(Array.from(f.values().value)).toEqual(ROWS.flat().map((v) => 100 + v));
  });

  it("rg-uv reads u from red and v from green, with speed", async () => {
    const f = (await decodeGrid(file, spec({ encoding: "rg-uv", range: [-40, 40], grid: geometry }), host)) as VectorGridField;
    expect(f.kind).toBe("vector");
    const s = f.sample([270, -10])!; // byte 23 / 232
    expect(s.u).toBeCloseTo(-40 + (23 * 80) / 255, 10);
    expect(s.v).toBeCloseTo(-40 + (232 * 80) / 255, 10);
    expect(s.speed).toBeCloseTo(Math.hypot(s.u, s.v), 10);
    const values = f.values();
    expect(values.u[7]).toBeCloseTo(-40 + (13 * 80) / 255, 5);
    expect(values.v[7]).toBeCloseTo(-40 + (242 * 80) / 255, 5);
    expect(f.values()).toBe(values);
  });

  it("the bounds form takes nx and ny from the image and names the same nodes", async () => {
    const f = (await decodeGrid(file, spec({ encoding: "scalar-r", range: [0, 255], bounds: [-45, -15, 315, 15] }), host)) as ScalarGridField;
    expect(f.grid).toEqual(geometry);
    expect(f.bounds).toEqual([-45, -15, 315, 15]);
    expect(f.wraps).toBe(true);
    expect(f.sample([90, 0])).toBe(11);
  });

  it("rescale gives a new field from the retained bytes and leaves the old one as it was", async () => {
    const f = (await decodeGrid(file, spec({ encoding: "scalar-r", range: [0, 255], grid: geometry }), host)) as ScalarGridField;
    const before = f.values();
    const g = f.rescale([0, 510]) as ScalarGridField;
    expect(g).not.toBe(f);
    expect(g.range).toEqual([0, 510]);
    expect(g.sample([90, 0])).toBe(22);
    expect(f.sample([90, 0])).toBe(11);
    expect(f.values()).toBe(before);
    expect(g.values().value[5]).toBe(22);
    expect(g.grid).toEqual(f.grid);
    expect(Object.isFrozen(g)).toBe(true);
  });

  it("values() hands out a copy of the missing mask: writing to it changes neither the field nor a rescaled sibling", async () => {
    const f = (await decodeGrid(file, spec({ encoding: "scalar-r", range: [0, 255], grid: geometry }), host)) as ScalarGridField;
    const values = f.values();
    values.missing[5] = 1;
    values.missing.fill(1, 8);
    expect(f.isMissing(1, 1)).toBe(false);
    expect(f.sample([90, 0])).toBe(11);
    expect(f.sample([0, -10])).toBe(20);
    expect(f.values().missing[5]).toBe(1); // the materialization itself is kept, as documented
    const g = f.rescale([0, 510]) as ScalarGridField;
    expect(g.isMissing(1, 1)).toBe(false);
    expect(g.sample([90, 0])).toBe(22);
    expect(Array.from(g.values().missing)).toEqual(new Array(12).fill(0));
    expect(g.values().missing).not.toBe(values.missing);
  });

  it("the declared grid must match the image: a dimension mismatch names both", async () => {
    const error = await failure(decodeGrid(file, spec({ encoding: "scalar-r", range: [0, 1], grid: { ...geometry, nx: 5, ny: 2 } }), host));
    expect(error.failure).toMatchObject({ code: "dimensions", format: "grid", url: URL, gridSize: { declared: [5, 2], actual: [4, 3] } });
    expect(error.message).toContain("4 × 3");
    expect(error.message).toContain("nx: 5");
    expect(error.message).toContain("ny: 2");
  });
});

describe("the committed 1° frames (examples/verification/null-earth/data)", () => {
  const geometry = { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 };
  const wind = spec({ encoding: "rg-uv", url: "2026111400-f000-wind-10m.png", range: [-40, 40], grid: geometry, units: "m/s", nodata: { channel: "b", below: 128 } });
  const temp = spec({ encoding: "scalar-r", url: "2026111400-f000-temp-2m.png", range: [193, 328], grid: geometry, units: "K", nodata: { channel: "b", above: 153 } });

  it("Covers AE1: the wind frame wraps, so the two sides of the date line read continuously", async () => {
    const f = (await decodeGrid(fixture(wind.url), wind, host)) as VectorGridField;
    expect(f.kind).toBe("vector");
    expect(f.wraps).toBe(true);
    expect(f.bounds).toEqual([-180.5, -90.5, 179.5, 90.5]);
    const east = f.sample({ lng: 179.9, lat: 0 })!;
    const west = f.sample({ lng: -179.9, lat: 0 })!;
    expect(east).not.toBeNull();
    expect(west).not.toBeNull();
    // Both lie within a tenth of a cell of the node at -180°: their
    // difference is below the step between it and either neighbour.
    const at = (lng: number) => f.sample({ lng, lat: 0 })!.speed;
    const step = Math.max(Math.abs(at(-180) - at(179)), Math.abs(at(-180) - at(-179)));
    expect(Math.abs(east.speed - west.speed)).toBeLessThan(step + 1e-9);
    expect(at(180)).toBe(at(-180));
    expect(at(540)).toBe(at(-180));
  });

  it("the wind frame's u and v match pngjs byte for byte (the blue 255 and alpha 255 are not data)", async () => {
    const f = (await decodeGrid(fixture(wind.url), wind, host)) as VectorGridField;
    const png = PNG.sync.read(readFileSync(join(FIXTURES, wind.url)));
    const { u, v, missing } = f.values();
    expect(u.length).toBe(360 * 181);
    for (let i = 0; i < u.length; i++) {
      expect(u[i]).toBeCloseTo(-40 + (png.data[i * 4]! * 80) / 255, 4);
      expect(v[i]).toBeCloseTo(-40 + (png.data[i * 4 + 1]! * 80) / 255, 4);
      expect(missing[i]).toBe(0);
    }
  });

  it("Covers AE2: the temperature frame reads warm over the Sahara and cold over Antarctica, as numbers", async () => {
    const f = (await decodeGrid(fixture(temp.url), temp, host)) as ScalarGridField;
    expect(f.kind).toBe("scalar");
    const sahara = f.sample({ lng: 10, lat: 25 });
    const antarctica = f.sample({ lng: 0, lat: -80 });
    expect(typeof sahara).toBe("number");
    expect(typeof antarctica).toBe("number");
    expect(sahara!).toBeGreaterThan(280);
    expect(antarctica!).toBeLessThan(265);
    // Against pngjs at those nodes.
    const png = PNG.sync.read(readFileSync(join(FIXTURES, temp.url)));
    const byte = (col: number, row: number) => png.data[(row * 360 + col) * 4]!; // pngjs expands RGB to RGBA
    expect(sahara).toBeCloseTo(193 + (byte(190, 65) * 135) / 255, 10);
    expect(antarctica).toBeCloseTo(193 + (byte(180, 170) * 135) / 255, 10);
  });

  it("decodes the 1° wind frame and a synthetic 1440 × 721 RGBA frame in a measured time", async () => {
    const bytes = fixture(wind.url);
    const t0 = performance.now();
    await decodeGrid(bytes, wind, host);
    const oneDegree = performance.now() - t0;
    // A quarter-degree frame: pngjs-written, noisy (little compression help).
    const width = 1440;
    const height = 721;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([(i * 7) & 0xff, (i * 13) & 0xff, 255, 255], i);
    const big = bytesOf(new Uint8Array(PNG.sync.write(Object.assign(new PNG({ width, height }), { data: Buffer.from(rgba) }), { colorType: 6 })));
    const t1 = performance.now();
    const f = await decodeGrid(big, spec({ encoding: "rg-uv", range: [-40, 40], bounds: [-180, -90, 180, 90] }), host);
    const quarterDegree = performance.now() - t1;
    expect([f.nx, f.ny]).toEqual([width, height]);
    expect(f.wraps).toBe(true);
    console.log(`[grid-decode] 360x181 RGBA: ${oneDegree.toFixed(1)} ms; 1440x721 RGBA (${(big.byteLength / 1024).toFixed(0)} KB): ${quarterDegree.toFixed(1)} ms`);
    expect(quarterDegree).toBeLessThan(5000);
  });
});

describe("nullschool-json", () => {
  it("two records are a vector field, u then v by parameterNumber (2, 3) whatever their order, with lo1 0 unrolled", async () => {
    const u = ROWS.flat();
    const v = ROWS.flat().map((x) => -x);
    const text = JSON.stringify([
      record({ lo1: 0, la1: 10, dx: 90, dy: 10, nx: 4, ny: 3, parameterCategory: 2, parameterNumber: 3 }, v),
      record({ lo1: 0, la1: 10, dx: 90, dy: 10, nx: 4, ny: 3, parameterCategory: 2, parameterNumber: 2 }, u),
    ]);
    const f = (await decodeGrid(bytesOf(new TextEncoder().encode(text)), json({ units: "m/s" }), host)) as VectorGridField;
    expect(f.kind).toBe("vector");
    expect(f.units).toBe("m/s");
    expect(f.grid.lo1).toBe(0);
    expect(f.wraps).toBe(true);
    expect(f.sample([270, -10])).toEqual({ u: 23, v: -23, speed: Math.hypot(23, 23) });
    expect(f.sample([-90, -10])).toEqual({ u: 23, v: -23, speed: Math.hypot(23, 23) });
    expect(f.sample([315, 10])).toMatchObject({ u: 1.5, v: -1.5 });
  });

  it("without parameterNumber, the records' order is u then v", async () => {
    const text = JSON.stringify([record({ lo1: 0, la1: 10, dx: 90, dy: 10, nx: 4, ny: 3 }, ROWS.flat()), record({ lo1: 0, la1: 10, dx: 90, dy: 10, nx: 4, ny: 3 }, ROWS.flat().map((x) => x * 2))]);
    const f = (await decodeGrid(bytesOf(new TextEncoder().encode(text)), json(), host)) as VectorGridField;
    expect(f.sample([90, 0])).toEqual({ u: 11, v: 22, speed: Math.hypot(11, 22) });
  });

  it("refuses a header whose rows run south to north (la2 north of la1) rather than decoding the field upside down", async () => {
    const text = JSON.stringify([record({ lo1: 0, la1: -90, la2: 90, dx: 90, dy: 180, nx: 4, ny: 2 }, [0, 1, 2, 3, 10, 11, 12, 13])]);
    const error = await failure(decodeGrid(bytesOf(new TextEncoder().encode(text)), json(), host));
    expect(error.failure).toMatchObject({ code: "read", format: "grid" });
    expect(error.failure.detail).toContain("rows run south to north");
    expect(error.failure.detail).toContain("a grid's first row must be its northern edge");
    expect(error.message).toContain("south to north");
    // The usual way round (la2 south of la1, or no la2 at all) decodes.
    const north = JSON.stringify([record({ lo1: 0, la1: 90, la2: -90, dx: 90, dy: 180, nx: 4, ny: 2 }, [0, 1, 2, 3, 10, 11, 12, 13])]);
    const f = (await decodeGrid(bytesOf(new TextEncoder().encode(north)), json(), host)) as ScalarGridField;
    expect(f.sample([90, 90])).toBe(1);
    expect(f.sample([90, -90])).toBe(11);
  });

  it("two records that describe different grids are refused: u and v must share one", async () => {
    const text = JSON.stringify([record({ lo1: 0, la1: 10, dx: 90, dy: 10, nx: 4, ny: 3 }, ROWS.flat()), record({ lo1: 10, la1: 10, dx: 90, dy: 10, nx: 4, ny: 3 }, ROWS.flat())]);
    const error = await failure(decodeGrid(bytesOf(new TextEncoder().encode(text)), json(), host));
    expect(error.failure).toMatchObject({ code: "read", format: "grid" });
    expect(error.failure.detail).toContain("describe different grids");
  });

  it("refuses what isn't a nullschool file: not JSON, no records, a record without a header, data of the wrong length, three records", async () => {
    const notJson = await failure(decodeGrid(bytesOf(new TextEncoder().encode("<html>")), json(), host));
    expect(notJson.failure).toMatchObject({ code: "not-format", format: "grid", expected: "JSON" });
    expect(notJson.message).toContain("isn't a JSON file");
    const empty = await failure(decodeGrid(bytesOf(new TextEncoder().encode("[]")), json(), host));
    expect(empty.failure.code).toBe("read");
    const noHeader = await failure(decodeGrid(bytesOf(new TextEncoder().encode('[{"data":[1]}]')), json(), host));
    expect(noHeader.failure.code).toBe("read");
    const short = await failure(decodeGrid(scalarJson({ data: [1, 2, 3] }), json(), host));
    expect(short.failure.code).toBe("read");
    expect(short.message).toMatch(/12 values/);
    const three = JSON.stringify([1, 2, 3].map(() => record({ lo1: 0, la1: 10, dx: 90, dy: 10, nx: 4, ny: 3 }, ROWS.flat())));
    const tooMany = await failure(decodeGrid(bytesOf(new TextEncoder().encode(three)), json(), host));
    expect(tooMany.failure.code).toBe("read");
  });
});

describe("geotiff, through the COG chunk's band reader", () => {
  /**
   * Rename TIFF tags and GeoKeys in place, by id: the geotiff writer always
   * writes a pixel scale, a tie point and a GeographicTypeGeoKey, and the
   * reader's refusals need files without them. A tag renamed to a private id
   * is still in the directory, but means nothing to any reader.
   */
  function retag(buffer: ArrayBuffer, tags: Record<number, number>, geoKeys: Record<number, number> = {}): ArrayBuffer {
    const view = new DataView(buffer);
    const le = view.getUint16(0, true) === 0x4949;
    const ifd = view.getUint32(4, le);
    const count = view.getUint16(ifd, le);
    for (let i = 0; i < count; i++) {
      const at = ifd + 2 + i * 12;
      const tag = view.getUint16(at, le);
      if (tags[tag] !== undefined) view.setUint16(at, tags[tag]!, le);
      if (tag === 34735) {
        // GeoKeyDirectory: SHORTs at the offset — [version, revision, minor, n] then [key, location, count, value]…
        const n = view.getUint32(at + 4, le);
        const offset = n * 2 > 4 ? view.getUint32(at + 8, le) : at + 8;
        for (let k = 4; k < n; k += 4) {
          const key = view.getUint16(offset + k * 2, le);
          if (geoKeys[key] !== undefined) view.setUint16(offset + k * 2, geoKeys[key]!, le);
        }
      }
    }
    return buffer;
  }

  /**
   * A 4 × 3 two-band float32 GeoTIFF over [0, -15, 360, 15] (cell edges),
   * EPSG:4326 unless told otherwise. `geographic: false` strips the
   * GeographicTypeGeoKey (a geographic model with no EPSG code, as some
   * writers leave it); `georeferenced: false` strips the pixel scale and tie point.
   */
  function tiff(
    options: { bands?: number; epsg?: number; nodata?: number; values?: (band: number, i: number) => number; geographic?: false; georeferenced?: false } = {}
  ): ArrayBuffer {
    const bands = options.bands ?? 2;
    const value = options.values ?? ((band, i) => (band === 0 ? ROWS.flat()[i]! : -ROWS.flat()[i]!));
    const flat = new Float32Array(4 * 3 * bands);
    for (let i = 0; i < 12; i++) for (let b = 0; b < bands; b++) flat[i * bands + b] = value(b, i);
    const metadata: Record<string, unknown> = {
      width: 4,
      height: 3,
      ModelPixelScale: [90, 10, 0],
      ModelTiepoint: [0, 0, 0, -45, 15, 0],
      ...(options.epsg === 3857
        ? { ProjectedCSTypeGeoKey: 3857, GTModelTypeGeoKey: 1 }
        : { GeographicTypeGeoKey: options.epsg ?? 4326, GTModelTypeGeoKey: 2 }),
      ...(options.nodata !== undefined ? { GDAL_NODATA: `${options.nodata}\0` } : {}),
    };
    const written = writeArrayBuffer(flat, metadata as never);
    const tags: Record<number, number> = options.georeferenced === false ? { 33550: 65000, 33922: 65001 } : {};
    const geoKeys: Record<number, number> = options.geographic === false ? { 2048: 2999 } : {};
    return retag(written, tags, geoKeys);
  }
  const geotiff = (s: Partial<GridSource> = {}) => spec({ encoding: "geotiff", url: "data/field.tif", ...s });

  it("a geographic model with no GeographicTypeGeoKey (unlabelled longitude/latitude) decodes like EPSG:4326", async () => {
    const bytes = tiff({ geographic: false });
    const cog = await getDecoder("cog");
    expect(cog.readCogHeader(new Uint8Array(bytes))).toMatchObject({ crs: "longitude/latitude" });
    const f = (await decodeGrid(bytes, geotiff({ bands: [0, 1] }), host)) as VectorGridField;
    expect(f.grid).toEqual({ nx: 4, ny: 3, lo1: 0, la1: 10, dx: 90, dy: 10 });
    expect(f.sample([90, 0])).toEqual({ u: 11, v: -11, speed: Math.hypot(11, 11) });
  });

  it("a GeoTIFF without a pixel scale and tie point is refused: no georeferencing", async () => {
    const error = await failure(decodeGrid(tiff({ georeferenced: false }), geotiff(), host));
    expect(error.failure).toMatchObject({ code: "read", format: "grid" });
    expect(error.failure.detail).toContain("no georeferencing");
    expect(error.message).toContain("couldn't be read as a grid");
  });

  it("two bands sample to the source arrays, with geometry from the file", async () => {
    const f = (await decodeGrid(tiff(), geotiff({ bands: [0, 1], units: "m/s" }), host)) as VectorGridField;
    expect(f.kind).toBe("vector");
    expect(f.grid).toEqual({ nx: 4, ny: 3, lo1: 0, la1: 10, dx: 90, dy: 10 });
    expect(f.bounds).toEqual([-45, -15, 315, 15]);
    expect(f.wraps).toBe(true);
    expect(f.sample([90, 0])).toEqual({ u: 11, v: -11, speed: Math.hypot(11, 11) });
    expect(f.sample([-45, 10])).toMatchObject({ u: 1.5, v: -1.5 });
    expect(Array.from(f.values().u)).toEqual(ROWS.flat());
    expect(() => f.rescale([0, 1])).toThrow(/physical values|range/);
  });

  it("one band (the default: band 0) is a scalar field; a chosen band reads that band", async () => {
    const one = (await decodeGrid(tiff(), geotiff(), host)) as ScalarGridField;
    expect(one.kind).toBe("scalar");
    expect(one.sample([90, 0])).toBe(11);
    const second = (await decodeGrid(tiff(), geotiff({ bands: [1] }), host)) as ScalarGridField;
    expect(second.sample([90, 0])).toBe(-11);
  });

  it("the GDAL_NODATA tag and the declared nodata number both mark nodes missing; NaN is missing too", async () => {
    const tagged = (await decodeGrid(tiff({ bands: 1, nodata: -9999, values: (_b, i) => (i === 5 ? -9999 : i) }), geotiff(), host)) as ScalarGridField;
    expect(tagged.isMissing(1, 1)).toBe(true);
    expect(tagged.sample([90, 0])).toBeNull();
    expect(tagged.sample([270, 0])).toBe(7);
    const declared = (await decodeGrid(tiff({ bands: 1, values: (_b, i) => (i === 5 ? -1 : i === 6 ? NaN : i) }), geotiff({ nodata: -1 }), host)) as ScalarGridField;
    expect(declared.isMissing(1, 1)).toBe(true);
    expect(declared.isMissing(2, 1)).toBe(true);
    expect(declared.isMissing(3, 1)).toBe(false);
  });

  it("refuses EPSG:3857 with the crs code, worded for a grid", async () => {
    const error = await failure(decodeGrid(tiff({ epsg: 3857 }), geotiff(), host));
    expect(error.failure).toMatchObject({ code: "crs", format: "grid", crs: "EPSG:3857" });
    expect(error.message).toContain("EPSG:3857");
    expect(error.message).toContain("EPSG:4326");
    expect(error.message).not.toContain("Web Mercator");
    expect(error.message).not.toContain("ogr2ogr");
  });

  it("refuses bytes that aren't a TIFF, and a band the file doesn't have", async () => {
    const notTiff = await failure(decodeGrid(bytesOf(new TextEncoder().encode("<!doctype html>")), geotiff(), host));
    expect(notTiff.failure).toMatchObject({ code: "not-format", expected: "GeoTIFF" });
    expect(notTiff.message).toContain("isn't a GeoTIFF file");
    const band = await failure(decodeGrid(tiff(), geotiff({ bands: [0, 5] }), host));
    expect(band.failure.code).toBe("read");
    expect(band.message).toMatch(/band 5/);
    expect(band.message).toMatch(/2 bands/);
  });

  it("the COG chunk exports the band reader", async () => {
    const lib = await getDecoder("cog");
    const read = await lib.readBands(tiff({ nodata: -9999 }), [1]);
    expect(read).toMatchObject({ width: 4, height: 3, epsg: 4326, nodata: -9999 });
    expect(read.bounds).toEqual([-45, -15, 315, 15]);
    expect(read.bands).toHaveLength(1);
    expect(Array.from(read.bands[0]!)).toEqual(ROWS.flat().map((x) => -x));
  });
});

describe("refusals", () => {
  const image = (s: Partial<GridSource> = {}) => spec({ encoding: "scalar-r", range: [0, 1], bounds: [-45, -15, 315, 15], ...s });

  it("Covers AE6: a 16-bit PNG names the bit depth and says 8-bit is required", async () => {
    const sixteen = buildPng({ width: 4, height: 3, colorType: 2, bitDepth: 16, scanlines: [new Uint8Array(25), new Uint8Array(25), new Uint8Array(25)] });
    const error = await failure(decodeGrid(bytesOf(sixteen), image(), host));
    expect(error.failure).toMatchObject({ code: "encoding", format: "grid", image: { bitDepth: 16, colorType: "RGB", interlaced: false } });
    expect(error.message).toContain("16-bit");
    expect(error.message).toContain("8-bit");
  });

  it("an interlaced PNG and a palette PNG are named as such", async () => {
    const interlaced = buildPng({ width: 4, height: 3, colorType: 6, interlace: 1, scanlines: [new Uint8Array(17)] });
    const a = await failure(decodeGrid(bytesOf(interlaced), image(), host));
    expect(a.failure.image).toMatchObject({ interlaced: true });
    expect(a.message).toContain("interlaced");
    const palette = buildPng({ width: 4, height: 3, colorType: 3, palette: new Uint8Array(6), scanlines: plainScanlines(new Uint8Array(12), 4, 3, 1) });
    const b = await failure(decodeGrid(bytesOf(palette), image(), host));
    expect(b.failure.image).toMatchObject({ colorType: "palette" });
    expect(b.message).toContain("palette");
  });

  it("a grayscale PNG under rg-uv names the channel count", async () => {
    const gray = buildPng({ width: 4, height: 3, colorType: 0, scanlines: plainScanlines(new Uint8Array(12), 4, 3, 1) });
    const error = await failure(decodeGrid(bytesOf(gray), image({ encoding: "rg-uv", range: [-1, 1] }), host));
    expect(error.failure).toMatchObject({ code: "encoding", image: { channels: 1 } });
    expect(error.message).toContain("1 channel");
    expect(error.message).toContain("rg-uv");
    // The same image reads as scalar-r.
    const f = await decodeGrid(bytesOf(gray), image(), host);
    expect(f.kind).toBe("scalar");
  });

  it("JPEG bytes are not a PNG", async () => {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
    const error = await failure(decodeGrid(bytesOf(jpeg), image(), host));
    expect(error.failure).toMatchObject({ code: "not-format", format: "grid", expected: "PNG" });
    expect(error.message).toContain("isn't a PNG file");
  });

  it("a PNG whose header is over the cell cap fails before inflating, worded for a grid", async () => {
    expect(GRID_MAX_CELLS).toBe(16_000_000);
    // Header only — no IDAT — so decoding past the header would fail as corrupt instead.
    const huge = buildPng({ width: 5000, height: 4000, colorType: 6 });
    const error = await failure(decodeGrid(bytesOf(huge), image(), host));
    expect(error.failure).toMatchObject({ code: "too-large", format: "grid", cells: 20_000_000, limits: { cells: GRID_MAX_CELLS } });
    expect(error.message).toContain("20,000,000");
    expect(error.message).toContain("16,000,000");
    expect(error.message).toMatch(/coarser grid|smaller extent/);
    for (const forbidden of ["load:", "mlym prepare", "PMTiles", "by view", "viewport", "Range"]) {
      expect(error.message, forbidden).not.toContain(forbidden);
    }
    // The host's own limit applies.
    const small = buildPng({ width: 4, height: 3, colorType: 6 });
    const capped = await failure(decodeGrid(bytesOf(small), image(), { ...host, limits: { cells: 10 } }));
    expect(capped.failure).toMatchObject({ code: "too-large", cells: 12, limits: { cells: 10 } });
  });

  it("a nullschool header over the cell cap fails before the data is parsed", async () => {
    // Not valid JSON past the header: proof the data was never parsed.
    const text = '[{"header":{"lo1":0,"la1":90,"dx":0.01,"dy":0.01,"nx":36000,"ny":18001},"data":[1,2,3';
    const error = await failure(decodeGrid(bytesOf(new TextEncoder().encode(text)), json(), host));
    expect(error.failure).toMatchObject({ code: "too-large", cells: 36000 * 18001 });
  });

  it("a GeoTIFF over the cell cap fails from its size tags, before any band is read", async () => {
    // A little-endian TIFF with one directory of two entries — ImageWidth
    // 5000, ImageLength 4000 — and no image data at all.
    const tiff = new Uint8Array(8 + 2 + 2 * 12 + 4);
    const view = new DataView(tiff.buffer);
    tiff.set([0x49, 0x49, 42, 0], 0);
    view.setUint32(4, 8, true);
    view.setUint16(8, 2, true);
    const entry = (at: number, tag: number, value: number) => {
      view.setUint16(at, tag, true);
      view.setUint16(at + 2, 4, true); // LONG
      view.setUint32(at + 4, 1, true);
      view.setUint32(at + 8, value, true);
    };
    entry(10, 256, 5000);
    entry(22, 257, 4000);
    const error = await failure(decodeGrid(bytesOf(tiff), spec({ encoding: "geotiff", url: "x.tif" }), host));
    expect(error.failure).toMatchObject({ code: "too-large", cells: 20_000_000, limits: { cells: GRID_MAX_CELLS } });
    // A PNG under encoding: geotiff is not a TIFF.
    const png = await failure(decodeGrid(bytesOf(buildPng({ width: 1, height: 1, colorType: 0 })), spec({ encoding: "geotiff", url: "x.tif" }), host));
    expect(png.failure).toMatchObject({ code: "not-format", expected: "GeoTIFF" });
  });

  it("a corrupt PNG body is a read failure naming the file", async () => {
    const short = buildPng({ width: 4, height: 3, colorType: 6, scanlines: [new Uint8Array(17)] });
    const error = await failure(decodeGrid(bytesOf(short), image(), host));
    expect(error.failure).toMatchObject({ code: "read", format: "grid" });
    expect(error.message).toContain("couldn't be read as a grid");
  });

  it("fields are frozen: page code cannot change one another holds", async () => {
    const f: GridField = await decodeGrid(scalarJson(), json(), host);
    expect(Object.isFrozen(f)).toBe(true);
    expect(Object.isFrozen(f.grid)).toBe(true);
    expect(Object.isFrozen(f.bounds)).toBe(true);
  });
});
