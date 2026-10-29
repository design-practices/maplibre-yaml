// @vitest-environment node
/**
 * The Node-safe facts readers (large data round 2, U6; KTD12): what
 * `mlym prepare` reports about a GeoParquet or FlatGeobuf file, read from
 * its footer or header alone through any `AsyncBuffer` — a file handle in
 * the CLI, a range reader over HTTP — never the whole file, and never
 * refusing a projected CRS (the facts name it instead).
 *
 * The readers live in the reader chunks (formats/lib/); the index reaches
 * them through `cloudReaders`, so they stay out of the CDN entry.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readGeoParquetFacts,
  readFlatGeobufFacts,
  isFormatError,
  type AsyncBuffer,
  type GeoParquetFacts,
  type FlatGeobufFacts,
} from "../../src/index";
import { formatError } from "../../src/formats/errors";
import "../helpers/cloud-host";
import { canSkipByView, openBytes } from "../../src/formats/lib/geoparquet";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = join(PKG_ROOT, "../../docs/public/gallery-assets/cloud-native");
const DIST = join(PKG_ROOT, "dist");

/** An `AsyncBuffer` over a fixture that counts what is read through it. */
function counting(name: string): AsyncBuffer & { read: number; calls: [number, number][] } {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
  const buffer = {
    byteLength: bytes.byteLength,
    read: 0,
    calls: [] as [number, number][],
    async slice(start: number, end: number = bytes.byteLength): Promise<ArrayBuffer> {
      buffer.read += end - start;
      buffer.calls.push([start, end]);
      return bytes.slice(start, end).buffer;
    },
  };
  return buffer;
}

describe("readGeoParquetFacts", () => {
  it("reads an overview file's facts from its footer alone (R13)", async () => {
    const file = counting("lots-overviews.parquet");
    const facts: GeoParquetFacts = await readGeoParquetFacts(file, "lots-overviews.parquet");
    // Footer length 14,744 + its 8-byte trailer, plus the 4-byte head magic: nothing else.
    expect(file.read).toBeLessThanOrEqual(14_744 + 8 + 4);
    expect(file.read).toBeLessThan(file.byteLength / 3);

    expect(facts.format).toBe("geoparquet");
    expect(facts.byteLength).toBe(61_474);
    // The canonical (full-detail) level: rows and row groups, and the footer's totals.
    expect(facts.rows).toBe(600);
    expect(facts.rowGroups).toBe(3);
    expect(facts.totalRows).toBe(1732);
    expect(facts.totalRowGroups).toBe(11);
    expect(facts.rowsPerRowGroup).toEqual({ min: 200, max: 200 });
    expect(facts.bboxColumn).toBe("bbox");
    expect(facts.geometryColumn).toBe("geometry");
    expect(facts.encoding).toBe("WKB");
    expect(facts.lonLat).toBe(true);
    expect(facts.bbox).toEqual([10.100055, 42.050044, 10.132945, 42.066456]);
    expect(facts.compression.length).toBeGreaterThan(0);
    // The sort hint is what a by-view read judges on (canSkipByView).
    const opened = await openBytes(new Uint8Array(readFileSync(join(FIXTURES, "lots-overviews.parquet"))), "x");
    expect(facts.spatialOrder).toBe(canSkipByView(opened) ? "sorted" : "unsorted");
    expect(facts.spatialOrder).toBe("sorted");
    expect(facts.geometryTypes).toEqual(["Polygon"]);
    expect(facts.compression).toEqual(["ZSTD"]);

    expect(facts.overviews).toMatchObject({ version: "0.2.0", mode: "duplicating", known: true, canonicalLevel: 4 });
    expect(facts.overviews!.levels.map((l) => l.zoom)).toEqual([10, 11, 12, 13, 14]);
    expect(facts.overviews!.levels.map((l) => l.rows)).toEqual([256, 256, 256, 364, 600]);
    expect(facts.overviews!.levels.map((l) => l.rowGroups)).toEqual([2, 2, 2, 2, 3]);
    expect(facts.overviews!.levels[0]!.gsd).toBeCloseTo(38.2185, 3);
  });

  it("reports a sorted file with a bbox column as sorted, rows per group from the footer", async () => {
    const facts = await readGeoParquetFacts(counting("points.parquet"), "points.parquet");
    expect(facts.rows).toBe(400);
    expect(facts.rowGroups).toBe(8);
    expect(facts.rowsPerRowGroup).toEqual({ min: 50, max: 50 });
    expect(facts.overviews).toBeUndefined();
    const opened = await openBytes(new Uint8Array(readFileSync(join(FIXTURES, "points.parquet"))), "x");
    expect(facts.spatialOrder).toBe(canSkipByView(opened) ? "sorted" : "unsorted");
    expect(facts.geometryTypes.length).toBeGreaterThan(0);
  });

  it("reports no bbox column, and an unknown order, for a file without one", async () => {
    const facts = await readGeoParquetFacts(counting("districts-nobbox.parquet"), "districts-nobbox.parquet");
    expect(facts.bboxColumn).toBeUndefined();
    expect(facts.spatialOrder).toBe("unknown");
  });

  it("names a projected CRS instead of throwing", async () => {
    const facts = await readGeoParquetFacts(counting("districts-3857.parquet"), "districts-3857.parquet");
    expect(facts.lonLat).toBe(false);
    expect(facts.crs).toMatch(/3857|Pseudo-Mercator/);
    expect(facts.rows).toBe(48);
  });

  it("names a GeoArrow encoding instead of throwing", async () => {
    const facts = await readGeoParquetFacts(counting("points-geoarrow.parquet"), "points-geoarrow.parquet");
    expect(facts.encoding).toBe("point");
  });

  it("refuses a file that isn't Parquet in the readers' own words", async () => {
    const error = await readGeoParquetFacts(counting("not-really.parquet"), "not-really.parquet").catch((e: unknown) => e);
    expect(isFormatError(error)).toBe(true);
    expect((error as Error).message).toBe(formatError({ code: "not-format", format: "geoparquet", url: "not-really.parquet" }).message);
  });

  it("refuses plain Parquet as not GeoParquet", async () => {
    const error = await readGeoParquetFacts(counting("plain.parquet"), "plain.parquet").catch((e: unknown) => e);
    expect(isFormatError(error) && error.failure.code).toBe("not-geoparquet");
  });

  it("refuses a file too short to be Parquet", async () => {
    const tiny: AsyncBuffer = { byteLength: 6, slice: () => new Uint8Array([0x50, 0x41, 0x52, 0x31, 0, 0]).buffer };
    const error = await readGeoParquetFacts(tiny, "tiny.parquet").catch((e: unknown) => e);
    expect(isFormatError(error) && error.failure.code).toBe("not-format");
  });
});

describe("readFlatGeobufFacts", () => {
  it("reads an indexed file's header from its first bytes (R13)", async () => {
    const file = counting("districts.fgb");
    const facts: FlatGeobufFacts = await readFlatGeobufFacts(file, "districts.fgb");
    // The 8-byte magic, the 4-byte length, the 1,172-byte header: nothing else.
    expect(file.read).toBeLessThanOrEqual(12 + 1172 + 12);
    expect(facts.format).toBe("flatgeobuf");
    expect(facts.byteLength).toBe(11_712);
    expect(facts.features).toBe(48);
    expect(facts.indexed).toBe(true);
    expect(facts.nodeSize).toBeGreaterThan(1);
    expect(facts.lonLat).toBe(true);
    expect(facts.crs).toBe("EPSG:4326");
    expect(facts.geometryType).toMatch(/Polygon/);
    expect(facts.envelope).toHaveLength(4);
    expect(facts.columns).toContain("name");
  });

  it("reports a file without a spatial index", async () => {
    const facts = await readFlatGeobufFacts(counting("points-noindex.fgb"), "points-noindex.fgb");
    expect(facts.indexed).toBe(false);
    expect(facts.nodeSize).toBe(0);
    expect(facts.features).toBe(400);
    expect(facts.geometryType).toBe("Point");
  });

  it("names a projected CRS instead of throwing", async () => {
    const facts = await readFlatGeobufFacts(counting("districts-3857.fgb"), "districts-3857.fgb");
    expect(facts.crs).toBe("EPSG:3857");
    expect(facts.lonLat).toBe(false);
  });

  it("refuses a file that isn't FlatGeobuf in the readers' own words", async () => {
    const error = await readFlatGeobufFacts(counting("not-really.fgb"), "not-really.fgb").catch((e: unknown) => e);
    expect(isFormatError(error)).toBe(true);
    expect((error as Error).message).toBe(formatError({ code: "not-format", format: "flatgeobuf", url: "not-really.fgb" }).message);
  });

  it("names a Zstandard-compressed file", async () => {
    const zstd = new Uint8Array(64);
    zstd.set([0x28, 0xb5, 0x2f, 0xfd]);
    const error = await readFlatGeobufFacts({ byteLength: 64, slice: (s, e) => zstd.slice(s, e).buffer }, "z.fgb").catch((e: unknown) => e);
    expect(isFormatError(error) && error.failure.code).toBe("compressed");
  });

  it("refuses a header cut short (its length runs past the file)", async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "districts.fgb")));
    const cut = bytes.slice(0, 200);
    const short: AsyncBuffer = { byteLength: cut.byteLength, slice: (s, e) => cut.slice(s, e).buffer };
    const error = await readFlatGeobufFacts(short, "cut.fgb").catch((e: unknown) => e);
    expect(isFormatError(error) && error.failure.code).toBe("not-format");
  });
});

describe.skipIf(!existsSync(join(DIST, "register.browser.js")))("the builds", () => {
  const read = (f: string) => readFileSync(join(DIST, f), "utf8");

  it("the CDN entry carries none of the facts readers", () => {
    const main = read("register.browser.js");
    for (const marker of ["readGeoParquetFacts", "readFlatGeobufFacts", "parquetFacts", "headerFacts"]) {
      expect(main.includes(marker), marker).toBe(false);
    }
  });

  it("the readers are in their chunks, and the tooling bundle exports them without a node: import", () => {
    // (`includes`, not `toContain`: a failure would print the whole bundle.)
    expect(read("chunks/geoparquet.js").includes("parquetFacts")).toBe(true);
    expect(read("chunks/flatgeobuf.js").includes("headerFacts")).toBe(true);
    const tooling = read("index.browser.js");
    expect(tooling.includes("readGeoParquetFacts")).toBe(true);
    expect(tooling.includes("readFlatGeobufFacts")).toBe(true);
    expect(tooling.match(/["'`]node:[a-z]/g) ?? []).toEqual([]);
  });
});
