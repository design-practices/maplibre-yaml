/**
 * The GeoParquet whole-file guard decides from the footer alone (ml-37r.16).
 *
 * @remarks
 * The PLUTO benchmark's citywide file: 856,687 rows, nine 100k-row groups,
 * and the 7 columns a map read were 47 MB compressed — under the 50 MB
 * transfer guard, so core decoded every row on the page and the tab crashed.
 * The real file's read columns decode to 142 MB (measured). A synthetic
 * footer of that shape (no data behind it: nothing may be read)
 * is refused on rows, as is one whose few rows decode to too many bytes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { FileMetaData } from "hyparquet";
import "../helpers/cloud-host";
import type { GeoParquetFile } from "../../src/formats/lib/geoparquet";
import {
  projectedSize,
  rowsInView,
  shareInView,
  GeoParquetLoader,
  VIEW_DECODE_FACTOR,
  loadGeoParquetWhole,
} from "../../src/formats/lib/geoparquet";
import {
  WholeFileTooLarge,
  WHOLE_FILE_MAX_FEATURES,
  WHOLE_FILE_MAX_DECODED_BYTES,
  WHOLE_FILE_MAX_BYTES,
  sizeLimits,
  loadModeOf,
} from "../../src/renderer/cloud-sources";
import { isFormatError } from "../../src/formats/errors";

const MB = 1024 * 1024;
const COLUMNS = ["LandUse", "NumFloors", "YearBuilt", "AssessTot", "BBL", "Address"];

/**
 * A footer: `groups` row groups of `rows / groups` rows each, side by side
 * west to east (Hilbert-like: each covers its own strip), whose read columns
 * total `compressed` / `uncompressed` bytes.
 */
function footer(rows: number, groups: number, compressed: number, uncompressed: number, ranges = true): GeoParquetFile {
  const read = [...COLUMNS, "geometry"];
  const chunk = (name: string, c: number, u: number, stats?: { min: number; max: number }) => ({
    file_offset: 0n,
    meta_data: {
      type: "BYTE_ARRAY",
      encodings: [],
      path_in_schema: name.split("."),
      codec: "ZSTD",
      num_values: BigInt(Math.round(rows / groups)),
      total_compressed_size: BigInt(Math.round(c)),
      total_uncompressed_size: BigInt(Math.round(u)),
      data_page_offset: 0n,
      ...(stats ? { statistics: { min_value: stats.min, max_value: stats.max } } : {}),
    },
  });
  const row_groups = Array.from({ length: groups }, (_, g) => {
    const x0 = -74.25 + (g * 0.55) / groups;
    const x1 = x0 + 0.55 / groups;
    return {
      num_rows: BigInt(Math.round(rows / groups)),
      total_byte_size: 0n,
      columns: [
        ...read.map((name) => chunk(name, compressed / groups / read.length, uncompressed / groups / read.length)),
        chunk("bbox.xmin", 0, 0, { min: x0, max: x1 }),
        chunk("bbox.ymin", 0, 0, { min: 40.5, max: 40.9 }),
        chunk("bbox.xmax", 0, 0, { min: x0, max: x1 }),
        chunk("bbox.ymax", 0, 0, { min: 40.5, max: 40.9 }),
      ],
    };
  });
  return {
    url: "/pluto.parquet",
    byteLength: 126 * MB,
    ranges,
    metadata: { version: 2, schema: [], num_rows: BigInt(rows), row_groups, metadata_length: 0 } as unknown as FileMetaData,
    info: {
      geometryColumn: "geometry",
      columns: COLUMNS,
      covering: { xmin: "bbox.xmin", ymin: "bbox.ymin", xmax: "bbox.xmax", ymax: "bbox.ymax" },
      rowGroups: groups,
      rows,
      bbox: [-74.25, 40.5, -73.7, 40.9],
    },
    file: {
      byteLength: 126 * MB,
      slice: vi.fn(async () => {
        throw new Error("the guard must decide before any data is read");
      }),
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("the GeoParquet whole-file guard, from a synthetic footer", () => {
  it("reads both sizes from the footer", () => {
    const [compressed, decoded] = projectedSize(footer(856_687, 9, 47 * MB, 142 * MB), "all");
    expect(compressed).toBeCloseTo(47 * MB, -3);
    expect(decoded).toBeCloseTo(142 * MB, -3);
  });

  it("the decoded-size guard catches the real citywide file on its own: an author's maxFeatures can't lift it", async () => {
    // 142 MB for the 7 columns the benchmark map reads; 111 MB for the geometry alone.
    for (const decoded of [142 * MB, 111 * MB]) {
      expect(decoded).toBeGreaterThan(WHOLE_FILE_MAX_DECODED_BYTES);
      const opened = footer(856_687, 86, 40 * MB, decoded, true);
      const limits = sizeLimits(undefined, loadModeOf({ load: { maxFeatures: 1_000_000 } }));
      const error = await loadGeoParquetWhole("/pluto.parquet", "all", { opened, limits }).catch((e) => e);
      expect(error).toBeInstanceOf(WholeFileTooLarge);
      expect(opened.file.slice).not.toHaveBeenCalled();
    }
    // Brooklyn's 44 MB passes.
    expect(44 * MB).toBeLessThan(WHOLE_FILE_MAX_DECODED_BYTES);
  });

  it("PLUTO citywide (856,687 rows, 47 MB compressed): refused on rows, before any data is read", async () => {
    const opened = footer(856_687, 9, 47 * MB, 142 * MB, false);
    expect(47 * MB).toBeLessThan(WHOLE_FILE_MAX_BYTES); // what let it through in 0.9.1
    const error = await loadGeoParquetWhole("/pluto.parquet", "all", { opened }).catch((e) => e);
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "too-large", features: 856_687 });
    expect(error.message).toContain(
      "has 856,687 features and reads columns that decode to 142 MB, more than a page loads whole (400,000 features, 100 MB decoded)"
    );
    // Not readable by view here: no ranges. The hosting is what to change.
    expect(error.message).toContain("it can't be read by view: this server doesn't support HTTP range requests");
    expect(error.message).toContain("Or list fewer `columns:`.");
    expect(error.message).not.toContain("maxFeatures"); // the decoded size is over too: raising it wouldn't help
    expect(error.message).toContain("convert it to PMTiles");
    expect(opened.file.slice).not.toHaveBeenCalled();
  });

  it("the same file, readable by view: switches to reading by view instead", async () => {
    const opened = footer(856_687, 9, 47 * MB, 142 * MB, true);
    const error = await loadGeoParquetWhole("/pluto.parquet", "all", { opened }).catch((e) => e);
    expect(error).toBeInstanceOf(WholeFileTooLarge);
    expect(error.features).toBe(856_687);
    expect(error.opened).toBe(opened);
  });

  it("Brooklyn (275,628 parcels, 14 MB compressed) still loads whole by default, as in 0.9.1 (M3)", async () => {
    expect(WHOLE_FILE_MAX_FEATURES).toBe(400_000);
    const opened = footer(275_628, 28, 14 * MB, 55 * MB, true);
    const error = await loadGeoParquetWhole("/bk.parquet", "all", { opened }).catch((e) => e);
    // Not refused, not switched to by view: the guard let it through, and the read began.
    expect(error).not.toBeInstanceOf(WholeFileTooLarge);
    // The decoder ran (and failed on a footer with no data behind it).
    expect(isFormatError(error) && error.failure.code).toBe("read");
  });

  it("an author's maxFeatures raises the whole-file limit (never lowers it); the decoded-size net stays (M3)", async () => {
    const big = footer(550_000, 55, 30 * MB, 90 * MB, true);
    const refused = await loadGeoParquetWhole("/big.parquet", "all", { opened: big }).catch((e) => e);
    expect(refused).toBeInstanceOf(WholeFileTooLarge);
    const raised = sizeLimits(undefined, loadModeOf({ load: { maxFeatures: 600_000 } }));
    expect(raised.maxFeatures).toBe(600_000);
    const read = await loadGeoParquetWhole("/big.parquet", "all", { opened: big, limits: raised }).catch((e) => e);
    expect(read).not.toBeInstanceOf(WholeFileTooLarge);
    expect(isFormatError(read) && read.failure.code).toBe("read"); // past the guard
    // A lower maxFeatures is the per-view budget only.
    expect(sizeLimits(undefined, loadModeOf({ load: { mode: "viewport", maxFeatures: 5000 } })).maxFeatures).toBe(400_000);
    // Citywide PLUTO is still caught on its decoded size, whatever the count allows.
    const pluto = footer(856_687, 9, 47 * MB, 142 * MB, true);
    const limits = sizeLimits(undefined, loadModeOf({ load: { maxFeatures: 1_000_000 } }));
    const caught = await loadGeoParquetWhole("/pluto.parquet", "all", { opened: pluto, limits }).catch((e) => e);
    expect(caught).toBeInstanceOf(WholeFileTooLarge);
    expect(pluto.file.slice).not.toHaveBeenCalled();
  });

  it("few rows that decode to too many bytes: refused too", async () => {
    const opened = footer(90_000, 9, 20 * MB, WHOLE_FILE_MAX_DECODED_BYTES + MB, false);
    expect(90_000).toBeLessThan(WHOLE_FILE_MAX_FEATURES);
    const error = await loadGeoParquetWhole("/pluto.parquet", "all", { opened }).catch((e) => e);
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "too-large", features: 90_000 });
  });

  it("a test hook can lower the limits for a small browser fixture", async () => {
    (globalThis as Record<string, unknown>).__MAPLIBRE_YAML_LIMITS__ = { maxFeatures: 10 };
    try {
      const opened = footer(90, 9, 1000, 2000, false);
      const error = await loadGeoParquetWhole("/pluto.parquet", "all", { opened }).catch((e) => e);
      expect(isFormatError(error) && error.failure).toMatchObject({ code: "too-large", features: 90 });
    } finally {
      delete (globalThis as Record<string, unknown>).__MAPLIBRE_YAML_LIMITS__;
    }
  });

  it("estimates a view's rows from the row groups it overlaps", () => {
    const source = footer(900_000, 9, 47 * MB, 142 * MB);
    // The whole extent: every row.
    expect(rowsInView(source, [-75, 40, -73, 41])).toBe(900_000);
    // One group's strip (0.55 / 9 degrees wide), half of its height: half its rows.
    const x0 = -74.25 + 0.55 / 9;
    expect(rowsInView(source, [x0 + 1e-9, 40.5, x0 + 0.55 / 9 - 1e-9, 40.7])).toBeCloseTo(50_000, -2);
  });

  it("shareInView: area share, and a box with no area counts whole when touched", () => {
    expect(shareInView([0, 0, 2, 2], [1, 1, 3, 3])).toBe(0.25);
    expect(shareInView([0, 0, 2, 2], [5, 5, 6, 6])).toBe(0);
    expect(shareInView([1, 1, 1, 1], [0, 0, 2, 2])).toBe(1);
  });
});

describe("the row-group decode hint names the right fix (PR #206 verification)", () => {
  /** The hint for a view over `footer`'s whole extent, holding `estimate` features. */
  function hint(url: string, opened: GeoParquetFile, estimate: number): string | undefined {
    const loader = new GeoParquetLoader({} as never, url, loadModeOf({ load: "viewport" }), "all", {
      onData: vi.fn(),
      onError: vi.fn(),
    });
    (loader as unknown as { opened: GeoParquetFile }).opened = opened;
    const decode = (loader as unknown as { decodeTooCostly(v: number[], e: number): string | undefined }).decodeTooCostly;
    return decode.call(loader, [-75, 40, -73, 41], estimate);
  }

  it("decodes up to 3 × maxFeatures: a GDAL-sorted 10,000-row view (449,120 rows) is read", () => {
    expect(VIEW_DECODE_FACTOR).toBe(3);
    expect(hint("/c.parquet", footer(449_120, 45, 1e6, 1e6), 120_000)).toBeUndefined();
    expect(hint("/c.parquet", footer(600_000, 6, 1e6, 1e6), 145_000)).toBeDefined();
  });

  it("large row groups: rewrite with 10,000-row groups along a Hilbert curve", () => {
    const text = hint("/city_rg100k.parquet", footer(600_000, 6, 1e6, 1e6), 145_000)!;
    expect(text).toContain("has row groups of up to 100,000 rows");
    expect(text).toContain(
      "To fix it, rewrite the file with about 10,000-row groups, sorted along a Hilbert curve: `uvx --from geoparquet-io==1.7.0 gpio sort hilbert city_rg100k.parquet city_rg100k-hilbert.parquet --row-group-size 10000 --add-bbox`."
    );
    // At the default maxFeatures, decoding more isn't offered.
    expect(text).not.toContain("raise `maxFeatures`");
  });

  it("small row groups, loosely packed (GDAL's SORT_BY_BBOX): a Hilbert sort, never the same rewrite again", () => {
    const text = hint("/city-sorted.parquet", footer(500_000, 50, 1e6, 1e6), 94_189)!;
    expect(text).toContain("Its row groups are already small, but loosely packed");
    expect(text).toContain("gpio sort hilbert city-sorted.parquet city-sorted-hilbert.parquet");
    expect(text).not.toContain("-sorted-sorted");
    expect(text).not.toContain("10,000-row groups,");
  });

  it("a file the hint's own command already sorted: no rewrite suggested, PMTiles is", () => {
    const text = hint("/city-hilbert.parquet", footer(500_000, 50, 1e6, 1e6), 94_189)!;
    expect(text).not.toContain("gpio sort");
    expect(text).toContain("convert it to PMTiles");
  });

  it("a blob: URL names the command's files neutrally", () => {
    const text = hint("blob:http://localhost:5090/30df85f3-d9e1-41f6-bd5f-32875ea08ba0", footer(600_000, 6, 1e6, 1e6), 145_000)!;
    expect(text).toContain("gpio sort hilbert data.parquet data-hilbert.parquet");
    expect(text).not.toMatch(/30df85f3[^`]*\.parquet|'30df85f3/);
  });
});
