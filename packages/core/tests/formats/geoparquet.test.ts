// @vitest-environment node
// (jsdom's fetch globals drop a `Range` request header; Node's keep it.)
/**
 * GeoParquet (0.9, ml-cnv.4): opening (one suffix-range read), WKB geometry,
 * codecs, column projection, reading by view through the bbox covering
 * column's row-group statistics, the size guards and the failure classes —
 * against the committed fixtures (scripts/fixtures/cloud-native.py), served
 * by a stub `fetch` that honours (or, under /norange/, ignores) HTTP ranges
 * like the e2e server does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/cloud-host";
import {
  open,
  openBytes,
  decodeBytes,
  readAll,
  readBbox,
  projectedBytes,
  canSkipByView,
  rowsInView,
  rowGroupsInView,
  projectedSize,
  TAIL_BYTES,
  GeoParquetLoader,
  loadGeoParquetWhole,
  overviewBand,
  parseOverviews,
  readColumns,
  columnBytes,
  COLUMN_SCAN_MAX_BYTES,
  type Overviews,
} from "../../src/formats/lib/geoparquet";
import { ClassifyRuntime } from "../../src/renderer/classify-runtime";
import { applyClassifyToSpec, classifyRecordOf, resolveClassify, withData } from "../../src/classify/compile";
import { getDecoder, hasDecoder } from "../../src/formats/decoders";
import { decodeGeoParquet } from "../../src/index";
import { isFormatError } from "../../src/formats/errors";
import {
  loadModeOf,
  cloudSourceDataLoader,
  WholeFileTooLarge,
} from "../../src/renderer/cloud-sources";
import { loadSourceData } from "../../src/data/source-data";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/public/gallery-assets/cloud-native"
);
/** Files served in place of (or beside) the fixtures, by name. */
const overrides = new Map<string, Uint8Array>();
const fixture = (name: string) => overrides.get(name) ?? new Uint8Array(readFileSync(join(FIXTURES, name)));

type Log = { url: string; range?: string; method?: string; status: number; bytes: number }[];

/**
 * A fetch over the fixtures, honouring HTTP ranges (suffix ranges too) like
 * the e2e server, with its hosting prefixes:
 *
 * - `/norange/<file>`: `Range` ignored, 200 with the whole file;
 * - `/suffix416/<file>`: a suffix longer than the file is 416 (Fastly);
 * - `/suffix416all/<file>`: every suffix range is 416, without `Content-Range`
 *   (`npx http-server`), while plain ranges work;
 * - `/noexpose/<file>`: `Content-Range` unreadable, as a page on another
 *   origin sees GitHub Pages (`Content-Length` stays readable);
 * - `/nolength/<file>`: no `Content-Length` (a chunked response).
 *
 * `HEAD` answers with the size. 404 for anything else.
 */
function fixtureFetch(log: Log = []) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const m = /^(?:https?:\/\/[^/]+)?((?:\/(?:norange|suffix416all|suffix416|noexpose|nolength))*)\/(.+)$/.exec(url)!;
    const ranges = !m[1]!.includes("/norange");
    const suffix416 = /\/suffix416(?!all)/.test(m[1]!);
    const suffix416all = m[1]!.includes("/suffix416all");
    const expose = !m[1]!.includes("/noexpose");
    const length = !m[1]!.includes("/nolength");
    let bytes: Uint8Array;
    try {
      bytes = fixture(m[2]!);
    } catch {
      log.push({ url, status: 404, bytes: 0 });
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    const size = bytes.length;
    if (init?.method === "HEAD") {
      log.push({ url, method: "HEAD", status: 200, bytes: 0 });
      return new Response(null, { status: 200, headers: length ? { "content-length": String(size) } : {} });
    }
    const range = new Headers(init?.headers ?? {}).get("Range");
    const r = range && ranges ? /bytes=(\d*)-(\d*)/.exec(range) : null;
    if (r && suffix416all && r[1] === "") {
      log.push({ url, range, status: 416, bytes: 0 });
      return new Response(null, { status: 416 });
    }
    if (r && suffix416 && r[1] === "" && Number(r[2]) > size) {
      log.push({ url, range, status: 416, bytes: 0 });
      return new Response(null, { status: 416, headers: expose ? { "content-range": `bytes */${size}` } : {} });
    }
    if (r) {
      const start = r[1] === "" ? Math.max(0, size - Number(r[2])) : Number(r[1]);
      const end = r[1] === "" || r[2] === "" ? size - 1 : Math.min(Number(r[2]), size - 1);
      const body = bytes.slice(start, end + 1);
      log.push({ url, range, status: 206, bytes: body.length });
      return new Response(body, {
        status: 206,
        headers: {
          ...(expose ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
          ...(length ? { "content-length": String(body.length) } : {}),
        },
      });
    }
    log.push({ url, status: 200, bytes: size });
    if (!length) {
      // Chunked: 4 KB at a time, so a reader can stop part-way.
      let at = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= size) return controller.close();
          controller.enqueue(bytes.slice(at, (at += 4096)));
        },
      });
      return new Response(body, { status: 200 });
    }
    return new Response(bytes, { status: 200, headers: { "content-length": String(size) } });
  });
}

/** Enough of a MapLibre map for the loader: zoom, bounds, moveend. */
function fakeMap(zoom: number, bounds: [number, number, number, number]) {
  const handlers: Array<() => void> = [];
  return {
    zoom,
    bounds,
    getZoom() {
      return this.zoom;
    },
    getBounds() {
      const [w, s, e, n] = this.bounds;
      return { getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n };
    },
    on: (_: string, fn: () => void) => handlers.push(fn),
    off: vi.fn(),
    moveend: () => handlers.forEach((fn) => fn()),
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const failure = (error: unknown) => (isFormatError(error) ? error.failure : undefined);

describe("decodeBytes: WKB geometry, properties, codecs", () => {
  it("polygons with their properties", async () => {
    const fc = await decodeBytes(fixture("districts.parquet"), "districts.parquet");
    expect(fc.features).toHaveLength(48);
    expect(fc.features[0]!.geometry.type).toBe("Polygon");
    expect(fc.features[0]!.properties).toEqual({
      name: expect.stringMatching(/^District /),
      category: expect.any(String),
      population: expect.any(Number),
    });
    // The bbox covering column is file plumbing, not a property.
    expect(fc.features[0]!.properties).not.toHaveProperty("bbox");
  });

  it("points, with 64-bit integers as plain numbers (MapLibre can't carry a BigInt)", async () => {
    const fc = await decodeBytes(fixture("points.parquet"), "points.parquet");
    expect(fc.features).toHaveLength(400);
    expect(fc.features[0]!.geometry.type).toBe("Point");
    expect(typeof fc.features[0]!.properties!["id"]).toBe("number");
    expect(() => JSON.stringify(fc)).not.toThrow();
  });

  it.each(["points-zstd.parquet", "points-brotli.parquet"])("%s decodes to the same features as snappy", async (name) => {
    const snappy = await decodeBytes(fixture("points.parquet"), "points.parquet");
    const other = await decodeBytes(fixture(name), name);
    expect(other).toEqual(snappy);
  });

  it("keeps only the columns asked for", async () => {
    const fc = await decodeBytes(fixture("districts.parquet"), "d.parquet", { columns: ["name"] });
    expect(Object.keys(fc.features[0]!.properties!)).toEqual(["name"]);
  });

  it("GeoArrow geometry is refused with how to rewrite the file", async () => {
    const error = await decodeBytes(fixture("points-geoarrow.parquet"), "points-geoarrow.parquet").catch((e) => e);
    expect(failure(error)).toMatchObject({ code: "encoding", encoding: "point" });
    expect((error as Error).message).toContain("GEOMETRY_ENCODING=WKB out.parquet points-geoarrow.parquet");
  });

  it("projected data is refused with the reprojection command", async () => {
    const error = await decodeBytes(fixture("districts-3857.parquet"), "districts-3857.parquet").catch((e) => e);
    expect(failure(error)).toMatchObject({ code: "crs", crs: "EPSG:3857" });
    expect((error as Error).message).toContain("ogr2ogr -t_srs EPSG:4326 out.parquet districts-3857.parquet");
  });

  it("plain Parquet (no geometry metadata) and a web page are named for what they are", async () => {
    expect(failure(await decodeBytes(fixture("plain.parquet"), "plain.parquet").catch((e) => e))?.code).toBe(
      "not-geoparquet"
    );
    expect(failure(await decodeBytes(fixture("not-really.parquet"), "x.parquet").catch((e) => e))?.code).toBe(
      "not-format"
    );
  });

  it("the library comes through the seam; the public decodeGeoParquet decodes", async () => {
    expect(hasDecoder("geoparquet")).toBe(true);
    expect(await getDecoder("geoparquet")).toBe(await getDecoder("geoparquet"));
    expect(typeof (await getDecoder("geoparquet-brotli")).decompressBrotli).toBe("function");
    const fc = await decodeGeoParquet(fixture("districts.parquet"), "d.parquet");
    expect(fc.features).toHaveLength(48);
  });
});

describe("open: the footer in one suffix-range request", () => {
  it("reads metadata: geometry column, CRS, extent, covering, columns, row groups", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const source = await open("/points.parquet");
    expect(source.ranges).toBe(true);
    expect(source.byteLength).toBe(fixture("points.parquet").length);
    expect(source.info).toMatchObject({
      geometryColumn: "geometry",
      crs: "EPSG:4326",
      covering: { xmin: "bbox.xmin", ymin: "bbox.ymin", xmax: "bbox.xmax", ymax: "bbox.ymax" },
      columns: ["id", "kind", "value"],
      rowGroups: 8,
      rows: 400,
    });
    expect(source.info.bbox![0]).toBeCloseTo(10.0, 1);
    // One request, no HEAD: the suffix range returns the footer and the size.
    expect(log).toEqual([expect.objectContaining({ range: `bytes=-${TAIL_BYTES}`, status: 206 })]);
  });

  it("a small file is then read without another request", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const source = await open("/districts.parquet");
    const fc = await readAll(source);
    expect(fc!.features).toHaveLength(48);
    expect(log).toHaveLength(1);
  });

  it("a server without ranges sends the whole file: kept in memory, read from it", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const source = await open("/norange/points.parquet");
    expect(source.ranges).toBe(false);
    const fc = await readBbox(source, [10.0, 42.0, 10.1, 42.08]);
    expect(fc!.features.length).toBeGreaterThan(0);
    expect(log.map((r) => r.status)).toEqual([200]);
  });

  it("…unless that whole file is over the size guard: refused before its body is read", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await open("/norange/points.parquet", { maxWholeBytes: 10_000 }).catch((e) => e);
    expect(failure(error)).toMatchObject({ code: "no-range", format: "geoparquet" });
    expect((error as Error).message).toContain("python -m http.server");
  });

  it("…or as soon as that many bytes have streamed, when the server sent no Content-Length", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await open("/norange/nolength/points.parquet", { maxWholeBytes: 10_000 }).catch((e) => e);
    expect(failure(error)).toMatchObject({ code: "no-range", format: "geoparquet" });
    expect(failure(error)!.size).toBeGreaterThan(10_000);
    expect(failure(error)!.size).toBeLessThan(fixture("points.parquet").length);
  });

  it("a host that answers an oversized suffix range with 416 (Fastly: GitHub Pages, jsDelivr): read whole", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const source = await open("/suffix416/districts.parquet");
    expect(source.byteLength).toBe(fixture("districts.parquet").length);
    expect((await readAll(source))!.features).toHaveLength(48);
    // The 416, then the whole (small) file; nothing after.
    expect(log.map((r) => [r.status, r.range ?? null])).toEqual([
      [416, `bytes=-${TAIL_BYTES}`],
      [200, null],
    ]);
  });

  it("Content-Range hidden from this page (GitHub Pages, cross-origin): a small file is whole from one response", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const source = await open("/noexpose/districts.parquet");
    expect(source.byteLength).toBe(fixture("districts.parquet").length);
    expect((await readAll(source))!.features).toHaveLength(48);
    expect(log).toHaveLength(1);
  });

  it("…a file bigger than the first read: its size from a HEAD, the rest read by range", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    // A first read shorter than the file stands in for a file over 512 KB.
    const source = await open("/noexpose/points.parquet", { tailBytes: 8192 });
    expect(source.ranges).toBe(true);
    expect(source.byteLength).toBe(fixture("points.parquet").length);
    // The suffix read, the HEAD; then (this footer is over 8 KB) explicit ranges.
    expect(log.slice(0, 2).map((r) => r.method ?? r.status)).toEqual([206, "HEAD"]);
    const fc = await readAll(source, { columns: ["id"] });
    expect(fc!.features).toHaveLength(400);
    expect(log.slice(2).every((r) => r.status === 206 && !r.range!.startsWith("bytes=-"))).toBe(true);
  });

  it("…and with no size from HEAD either, the file is read whole (under the size guard)", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const source = await open("/noexpose/nolength/points.parquet", { tailBytes: 8192 });
    expect(source.byteLength).toBe(fixture("points.parquet").length);
    expect(log.map((r) => r.method ?? r.status)).toEqual([206, "HEAD", 200]);

    expect((await readAll(source))!.features).toHaveLength(400);
    const error = await open("/noexpose/nolength/points.parquet", { tailBytes: 8192, maxWholeBytes: 10_000 }).catch(
      (e) => e
    );
    expect(failure(error)?.code).toBe("too-large");
  });

  it("a range applied to a compressed copy (jsDelivr's Cloudflare leg, Content-Encoding: br): the decoded body is the file", async () => {
    // The browser decodes the brotli body to the whole file; Content-Range
    // still describes the 5 KB compressed copy.
    const file = fixture("districts.parquet");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(file, { status: 206, headers: { "content-range": "bytes 0-5630/5631" } }))
    );
    const source = await open("https://cdn.example/districts.parquet");
    expect(source.byteLength).toBe(file.length);
    expect((await readAll(source))!.features).toHaveLength(48);
  });

  it("ranges cut from a compressed copy (jsDelivr's Cloudflare leg, saying nothing): read whole instead (ml-zm7)", async () => {
    const { brotliCompressSync } = await import("node:zlib");
    const file = fixture("districts.parquet");
    const packed = new Uint8Array(brotliCompressSync(file));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: string, init?: RequestInit) => {
        if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-encoding": "br" } });
        const range = new Headers(init?.headers ?? {}).get("Range");
        if (!range) return new Response(file, { status: 200 }); // a whole reply: the browser decodes it
        const start = Math.max(0, packed.length - 524288);
        return new Response(packed.slice(start), {
          status: 206,
          headers: { "content-range": `bytes ${start}-${packed.length - 1}/${packed.length}` },
        });
      })
    );
    const source = await open("https://cdn.example/districts.parquet");
    expect(source.byteLength).toBe(file.length);
    expect((await readAll(source))!.features).toHaveLength(48);
  });

  it("a host that answers every suffix range with 416 (npx http-server): the tail by offsets, not the whole file (ml-cnv.33)", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const size = fixture("points.parquet").length;
    const source = await open("/suffix416all/points.parquet", { tailBytes: 16 * 1024 });
    expect(source.ranges).toBe(true);
    expect(source.byteLength).toBe(size);
    expect(log.slice(0, 3).map((r) => [r.status, r.method ?? r.range ?? null])).toEqual([
      [416, "bytes=-16384"],
      [200, "HEAD"],
      [206, `bytes=${size - 16384}-${size - 1}`],
    ]);
    expect(log.some((r) => r.status === 200 && !r.method)).toBe(false); // never the whole file
    expect((await readBbox(source, [10.0, 42.0, 10.1, 42.08]))!.features.length).toBeLessThan(400);
  });

  it("an oversized suffix answered 416 on a host that also hides the size: still read whole", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/suffix416/noexpose/points.parquet");
    expect((await readAll(source))!.features).toHaveLength(400);
  });

  it("a 404 is thrown in the GeoJSON fetcher's shape (same notice wording)", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await open("/missing.parquet").catch((e) => e);
    expect(error.message).toBe("HTTP 404: Not Found for /missing.parquet");
    expect(error.url).toBe("/missing.parquet");
  });

  it("a refused fetch (CORS / unreachable) is classified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const error = await open("https://elsewhere.example/a.parquet").catch((e) => e);
    expect(failure(error)?.code).toBe("cors");
  });

  it("a web page under a .parquet name is not-format (not a raw 'footer != PAR1')", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await open("/not-really.parquet").catch((e) => e);
    expect(failure(error)?.code).toBe("not-format");
    expect((error as Error).message).not.toMatch(/PAR1/);
  });
});

describe("column projection", () => {
  it("reads only the columns asked for, and moves fewer bytes", async () => {
    const all: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(all));
    const whole = await readAll(await open("/points.parquet"), { columns: "all" });
    vi.unstubAllGlobals();
    const some: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(some));
    const source = await open("/points.parquet");
    const projected = await readAll(source, { columns: ["kind"] });
    expect(Object.keys(whole!.features[0]!.properties!).sort()).toEqual(["id", "kind", "value"]);
    expect(Object.keys(projected!.features[0]!.properties!)).toEqual(["kind"]);
    expect(projectedBytes(source, ["kind"])).toBeLessThan(projectedBytes(source, "all"));
    // The footer read is the whole of this small file, so compare the
    // estimate rather than the transfer here; a name the file lacks is ignored.
    expect(projectedBytes(source, ["kind", "nope"])).toBe(projectedBytes(source, ["kind"]));
  });
});

describe("reading by view (bbox covering, row-group statistics)", () => {
  const VIEW: [number, number, number, number] = [10.0, 42.0, 10.1, 42.08];

  it("only the features whose bbox meets the view", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/points.parquet");
    const fc = await readBbox(source, VIEW, { columns: ["id"] });
    expect(fc!.features.length).toBeGreaterThan(0);
    expect(fc!.features.length).toBeLessThan(400);
    for (const f of fc!.features) {
      const [x, y] = (f.geometry as { coordinates: [number, number] }).coordinates;
      expect(x >= VIEW[0] && x <= VIEW[2] && y >= VIEW[1] && y <= VIEW[3]).toBe(true);
    }
    expect(Object.keys(fc!.features[0]!.properties!)).toEqual(["id"]);
  });

  it("skips row groups outside the view: 2 of 8 fetched, against all 8 for the whole read", async () => {
    // Serve the open with just the file's last 8 KB, so the data pages are
    // fetched by range afterwards and can be counted.
    const file = fixture("points.parquet");
    const reads: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: string, init?: RequestInit) => {
        const m = /bytes=(\d*)-(\d*)/.exec(new Headers(init?.headers ?? {}).get("Range")!)!;
        const start = m[1] === "" ? file.length - 8192 : Number(m[1]);
        const end = m[1] === "" ? file.length - 1 : Number(m[2]);
        reads.push(end - start + 1);
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: { "content-range": `bytes ${start}-${end}/${file.length}` },
        });
      })
    );
    const source = await open("/points.parquet");
    reads.length = 0; // the open (footer) reads aren't the view's
    await readBbox(source, VIEW);
    const byView = [...reads];
    reads.length = 0;
    await readAll(source);
    const whole = [...reads];
    expect(byView).toHaveLength(2);
    expect(whole).toHaveLength(8);
  });

  it("canSkipByView: sorted row groups yes; one row group or no covering column no", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    expect(canSkipByView(await open("/points.parquet"))).toBe(true);
    expect(canSkipByView(await open("/points-zstd.parquet"))).toBe(false);
    expect(canSkipByView(await open("/districts-nobbox.parquet"))).toBe(false);
  });

  it("canSkipByView: row groups that each span most of the file can't be skipped (ml-cnv.18)", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const sorted = await open("/points.parquet");
    expect(canSkipByView(sorted)).toBe(true);
    // The same 8 row groups, unsorted: every group's bbox statistics cover
    // the whole extent, so a view would still read all of them.
    const groups = structuredClone(sorted.metadata.row_groups);
    const extent = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
    const stat = (chunk: (typeof groups)[number]["columns"][number]) => chunk.meta_data?.statistics;
    for (const group of groups) {
      for (const chunk of group.columns) {
        const path = chunk.meta_data?.path_in_schema.join(".");
        const s = stat(chunk);
        if (path === "bbox.xmin") extent.xmin = Math.min(extent.xmin, Number(s?.min_value ?? s?.min));
        if (path === "bbox.ymin") extent.ymin = Math.min(extent.ymin, Number(s?.min_value ?? s?.min));
        if (path === "bbox.xmax") extent.xmax = Math.max(extent.xmax, Number(s?.max_value ?? s?.max));
        if (path === "bbox.ymax") extent.ymax = Math.max(extent.ymax, Number(s?.max_value ?? s?.max));
      }
    }
    for (const group of groups) {
      for (const chunk of group.columns) {
        const path = chunk.meta_data?.path_in_schema.join(".");
        const s = stat(chunk);
        if (!s) continue;
        if (path === "bbox.xmin") s.min_value = extent.xmin;
        if (path === "bbox.ymin") s.min_value = extent.ymin;
        if (path === "bbox.xmax") s.max_value = extent.xmax;
        if (path === "bbox.ymax") s.max_value = extent.ymax;
      }
    }
    const unsorted = { ...sorted, metadata: { ...sorted.metadata, row_groups: groups } };
    expect(groups).toHaveLength(8);
    expect(canSkipByView(unsorted)).toBe(false);
  });

  it("a file without a covering column can't be read by view", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await readBbox(await open("/districts-nobbox.parquet"), VIEW).catch((e) => e);
    expect(failure(error)?.code).toBe("no-index");
    expect((error as Error).message).toContain("write_covering_bbox=True");
  });

  it("openBytes reads the same metadata from memory", async () => {
    const source = await openBytes(fixture("points.parquet"), "points.parquet");
    expect(source.info.rowGroups).toBe(8);
    expect(source.ranges).toBe(false);
  });
});

describe("the fitTo prefetch seam (data/source-data)", () => {
  const ctx = { fetcher: { fetch: vi.fn() } as never };

  it("a GeoParquet source read whole is loaded ahead, with its resolved columns", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const fc = await loadSourceData({ type: "geojson", url: "/districts.parquet", columns: ["name"] }, ctx);
    expect(fc.features).toHaveLength(48);
    expect(Object.keys(fc.features[0]!.properties!)).toEqual(["name"]);
  });

  it("a viewport source is not loaded ahead", async () => {
    await expect(
      cloudSourceDataLoader({ type: "geojson", url: "/w.parquet", load: "viewport" }, ctx)
    ).rejects.toThrow(/not loaded ahead/);
  });
});

describe("the size guards (projected bytes, from the footer)", () => {
  const SMALL = { warn: 1_000, max: 10_000 };

  it("too large + sortable by view → rejects with WholeFileTooLarge (the loader then reads by view)", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await loadGeoParquetWhole("/points.parquet", "all", { limits: SMALL }).catch((e) => e);
    expect(error).toBeInstanceOf(WholeFileTooLarge);
    expect(error.size).toBeGreaterThan(SMALL.max);
  });

  it("too large and not readable by view → refused, with the projected size", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await loadGeoParquetWhole("/points-zstd.parquet", "all", { limits: { warn: 1_000, max: 2_000 } }).catch(
      (e) => e
    );
    expect(failure(error)).toMatchObject({ code: "too-large", format: "geoparquet", size: expect.any(Number) });
  });

  it("the guard counts only the projected columns", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/points-zstd.parquet");
    const limits = { warn: 1_000, max: projectedBytes(source, ["kind"]) + 1 };
    const read = await loadGeoParquetWhole("/points-zstd.parquet", ["kind"], { limits, opened: source });
    expect(read.data!.features).toHaveLength(400);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("may take a few seconds"));
  });
});

describe("GeoParquetLoader", () => {
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];

  async function run(
    url: string,
    options: { load?: ReturnType<typeof loadModeOf>; map?: ReturnType<typeof fakeMap>; columns?: readonly string[] | "all"; limits?: { warn: number; max: number; maxFeatures?: number } } = {}
  ) {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const onData = vi.fn();
    const onError = vi.fn();
    const map = options.map ?? fakeMap(12, AREA);
    const loader = new GeoParquetLoader(
      map as never,
      url,
      options.load ?? loadModeOf({}),
      options.columns ?? "all",
      { onData, onError },
      options.limits
    );
    await loader.start();
    return { loader, onData, onError, log, map };
  }

  it("load: all — every feature, the projected columns only", async () => {
    const { onData, onError, loader } = await run("/points.parquet", { columns: ["kind"] });
    expect(onError).not.toHaveBeenCalled();
    const fc = onData.mock.calls[0]![0];
    expect(fc.features).toHaveLength(400);
    expect(Object.keys(fc.features[0].properties)).toEqual(["kind"]);
    expect(loader.readsByView).toBe(false);
  });

  it("load: viewport — the features in view, extent from the metadata, re-read on moveend", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const map = fakeMap(12, [10.0, 42.0, 10.1, 42.08]);
      const { onData, loader } = await run("/points.parquet", { load: loadModeOf({ load: "viewport" }), map });
      const first = onData.mock.calls.at(-1)![0];
      expect(first.features.length).toBeGreaterThan(0);
      expect(first.features.length).toBeLessThan(400);
      expect(loader.readsByView).toBe(true);
      const [[w, s], [e, n]] = loader.extent!;
      expect([w, s, e, n].map((v) => Math.round(v * 10) / 10)).toEqual([10.0, 42.0, 10.4, 42.3]);
      // Pan to the other corner: a fresh read, different features.
      map.bounds = [10.3, 42.2, 10.4, 42.3];
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onData.mock.calls.length).toBeGreaterThan(1));
      const second = onData.mock.calls.at(-1)![0];
      const ids = (fc: { features: { properties: { id: number } }[] }) => fc.features.map((f) => f.properties.id);
      expect(ids(second).some((id: number) => ids(first).includes(id))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("load: viewport below minzoom — empty, with one console note", async () => {
    const { onData } = await run("/points.parquet", {
      load: loadModeOf({ load: { mode: "viewport", minzoom: 11 } }),
      map: fakeMap(9, AREA),
    });
    expect(onData.mock.calls.at(-1)![0].features).toHaveLength(0);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("is read by view from zoom 11"));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('To read it from here, lower "minzoom" to 9 under "load:"'));
  });

  it("load: viewport on a server without ranges reads the whole file instead", async () => {
    const { onData, onError, log } = await run("/norange/points.parquet", { load: loadModeOf({ load: "viewport" }) });
    expect(onError).not.toHaveBeenCalled();
    expect(onData.mock.calls[0]![0].features).toHaveLength(400);
    expect(log).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("doesn't support range requests"));
  });

  it("load: viewport on an unsorted file (one row group) reads it whole, with a note", async () => {
    const { onData, loader } = await run("/points-zstd.parquet", { load: loadModeOf({ load: "viewport" }) });
    expect(onData.mock.calls[0]![0].features).toHaveLength(400);
    expect(loader.readsByView).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("isn't spatially sorted"));
  });

  it("load: viewport on an unsorted file over the limit: refused for being unsorted, with no 'reading it whole' note first (ml-cnv.33)", async () => {
    const { onError } = await run("/points-zstd.parquet", {
      load: loadModeOf({ load: "viewport" }),
      limits: { warn: 1e6, max: 50e6, maxFeatures: 100 },
    });
    const error = onError.mock.calls[0]![0];
    expect(failure(error)).toMatchObject({ code: "too-large", features: 400, blocker: "unsorted" });
    expect(error.message).toContain("it can't be read by view: its rows aren't in spatially sorted row groups");
    expect(error.message).toContain("gpio sort hilbert points-zstd.parquet points-zstd-hilbert.parquet --row-group-size 10000");
    expect(error.message).not.toContain("Add `load: viewport`");
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("reading it whole instead"));
  });

  it("load: viewport on a host without range requests, over the limit: the refusal names the hosting (ml-cnv.33)", async () => {
    const { onError } = await run("/norange/points.parquet", {
      load: loadModeOf({ load: "viewport" }),
      limits: { warn: 1e6, max: 50e6, maxFeatures: 100 },
    });
    const error = onError.mock.calls[0]![0];
    expect(failure(error)).toMatchObject({ code: "too-large", blocker: "no-range" });
    expect(error.message).toContain("this server doesn't support HTTP range requests. Host it where they work");
    expect(error.message).not.toContain("Add `load: viewport`");
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("reads the whole file instead"));
  });

  it("load: viewport on a file without a covering column → says so", async () => {
    const { onError } = await run("/districts-nobbox.parquet", { load: loadModeOf({ load: "viewport" }) });
    expect(failure(onError.mock.calls[0]![0])?.code).toBe("no-index");
  });

  it("too large to load whole + sorted → read by view (with a console note)", async () => {
    const { onData, onError, loader } = await run("/points.parquet", { limits: { warn: 1_000, max: 10_000 } });
    expect(onError).not.toHaveBeenCalled();
    expect(loader.readsByView).toBe(true);
    expect(onData).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("so only the part in view is read"));
  });

  it("too large to load whole + not readable by view → refused, with the size", async () => {
    const { onError } = await run("/districts.parquet", { limits: { warn: 1_000, max: 2_000 } });
    expect(failure(onError.mock.calls[0]![0])).toMatchObject({ code: "too-large", size: expect.any(Number) });
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("only the part in view is read"));
  });

  it("a server without ranges and a file over the guard → the no-range notice", async () => {
    const { onError } = await run("/norange/points.parquet", { limits: { warn: 1_000, max: 10_000 } });
    expect(failure(onError.mock.calls[0]![0])?.code).toBe("no-range");
  });

  it("GeoArrow, a projected CRS and a missing file each reach onError in plain words", async () => {
    expect(failure((await run("/points-geoarrow.parquet")).onError.mock.calls[0]![0])?.code).toBe("encoding");
    expect(failure((await run("/districts-3857.parquet")).onError.mock.calls[0]![0])?.code).toBe("crs");
    expect((await run("/missing.parquet")).onError.mock.calls[0]![0].message).toBe(
      "HTTP 404: Not Found for /missing.parquet"
    );
  });

  it("reuses a whole-file load the host already started (no second request)", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const started = Promise.resolve({ type: "FeatureCollection" as const, features: [] });
    const onData = vi.fn();
    const loader = new GeoParquetLoader(fakeMap(12, AREA) as never, "/points.parquet", loadModeOf({}), "all", {
      onData,
      onError: vi.fn(),
    });
    await loader.start(started);
    expect(onData).toHaveBeenCalledWith({ type: "FeatureCollection", features: [] });
    expect(log).toEqual([]);
  });

  it("destroy() stops further reads and callbacks", async () => {
    const map = fakeMap(12, AREA);
    const { onData, loader } = await run("/points.parquet", { load: loadModeOf({ load: "viewport" }), map });
    const calls = onData.mock.calls.length;
    loader.destroy();
    map.moveend();
    await new Promise((r) => setTimeout(r, 300));
    expect(onData.mock.calls.length).toBe(calls);
  });
});

describe("LayerManager reads a GeoParquet url: (not the JSON fetch)", () => {
  function fakeLayerMap() {
    const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    return {
      sources,
      addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
      getSource: vi.fn((id: string) => sources.get(id)),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      getStyle: vi.fn(() => ({ sources: {} })),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      getZoom: () => 12,
      on: vi.fn(),
      off: vi.fn(),
    };
  }

  it("decodes the file into the source, with the columns the renderer resolved", async () => {
    const { LayerManager } = await import("../../src/renderer/layer-manager");
    vi.stubGlobal("fetch", fixtureFetch());
    const map = fakeLayerMap();
    const callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn() };
    const manager = new LayerManager(map as never, callbacks, {
      columnsFor: (id) => (id === "districts" ? ["name"] : undefined),
    });
    manager.registerSources({ districts: { type: "geojson", url: "/districts.parquet" } });
    await manager.addLayer({ id: "d", type: "fill", source: "districts" } as never);
    await vi.waitFor(() => expect(callbacks.onDataLoaded).toHaveBeenCalled());
    expect(callbacks.onDataError).not.toHaveBeenCalled();
    const data = manager.getSourceData("districts")!;
    expect(data.features).toHaveLength(48);
    expect(Object.keys(data.features[0]!.properties!)).toEqual(["name"]);
    expect(map.sources.get("districts")!.setData).toHaveBeenCalledWith(data);
    // Our keys never reach MapLibre.
    expect(JSON.stringify(map.addSource.mock.calls)).not.toMatch(/"columns"|"format"|"load"/);
  });

  it("an author's columns: wins over the resolver; viewport reads report readsByView and the file's extent", async () => {
    const { LayerManager } = await import("../../src/renderer/layer-manager");
    vi.stubGlobal("fetch", fixtureFetch());
    const map = {
      ...fakeLayerMap(),
      getBounds: () => ({ getWest: () => 10.0, getSouth: () => 42.0, getEast: () => 10.1, getNorth: () => 42.08 }),
    };
    const callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn() };
    const manager = new LayerManager(map as never, callbacks, { columnsFor: () => ["id"] });
    manager.registerSources({
      points: { type: "geojson", url: "/points.parquet", columns: ["kind"], load: "viewport" },
    });
    await manager.addLayer({ id: "p", type: "circle", source: "points" } as never);
    await vi.waitFor(() => expect(callbacks.onDataLoaded).toHaveBeenCalled());
    const data = manager.getSourceData("points")!;
    expect(data.features.length).toBeLessThan(400);
    expect(Object.keys(data.features[0]!.properties!)).toEqual(["kind"]);
    expect(manager.readsByView("points")).toBe(true);
    expect(manager.getSourceExtent("points")![0][0]).toBeCloseTo(10.0, 1);
  });

  it("a failure reaches onDataError in plain words (GeoArrow)", async () => {
    const { LayerManager } = await import("../../src/renderer/layer-manager");
    vi.stubGlobal("fetch", fixtureFetch());
    const callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn() };
    const manager = new LayerManager(fakeLayerMap() as never, callbacks);
    await manager.addLayer({
      id: "g",
      type: "circle",
      source: { type: "geojson", url: "/points-geoarrow.parquet" },
    } as never);
    await vi.waitFor(() => expect(callbacks.onDataError).toHaveBeenCalled());
    expect(failure(callbacks.onDataError.mock.calls[0]![1])?.code).toBe("encoding");
  });
});

describe("the file's own column names reach the classify hint (ml-aot.118)", () => {
  it("a misspelt field gets a did-you-mean and the file's columns, though only some were read", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const { classifyFieldProblems } = await import("../../src/classify/breaks");
    const { classifyFieldMessage } = await import("../../src/renderer/classify-runtime");
    // What the renderer reads for `classify: { field: populaton }`: that name alone.
    const data = await readAll(await open("/districts.parquet"), { columns: ["populaton"] });
    expect(Object.keys(data!.features[0]!.properties!)).toEqual([]);
    const [problem] = classifyFieldProblems(data, { field: "populaton", kind: "numeric" });
    expect(problem).toMatchObject({ reason: "missing", suggestion: "population" });
    const message = classifyFieldMessage("d", problem!);
    expect(message).toContain('Did you mean "population"?');
    expect(message).toContain('The data\'s properties: "name", "category", "population".');
  });

  it("a real column that columns: leaves out is named as such, not misspelt", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const { classifyFieldProblems } = await import("../../src/classify/breaks");
    const { classifyFieldMessage } = await import("../../src/renderer/classify-runtime");
    const data = await readAll(await open("/districts.parquet"), { columns: ["name"] });
    const [problem] = classifyFieldProblems(data, { field: "population", kind: "numeric" });
    expect(problem).toMatchObject({ reason: "missing", unread: true });
    expect(problem!.suggestion).toBeUndefined();
    expect(classifyFieldMessage("d", problem!)).toContain("is a column of the file, but columns: leaves it out");
  });
});

describe("GeoParquet per-view budget (ml-37r.17)", () => {
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];

  it("estimates a view's rows from the row groups' covering statistics", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/points.parquet");
    expect(rowsInView(source, [9, 41, 11, 43])).toBe(400);
    expect(rowsInView(source, [0, 0, 1, 1])).toBe(0);
    const part = rowsInView(source, [10.0, 42.0, 10.1, 42.08]);
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(200);
  });

  it("a view over the budget isn't read: no row group fetched, one hint, then read once zoomed in", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const log: Log = [];
      vi.stubGlobal("fetch", fixtureFetch(log));
      const map = fakeMap(12, AREA);
      const onData = vi.fn();
      const onHint = vi.fn();
      const onTooDense = vi.fn();
      const loader = new GeoParquetLoader(
        map as never,
        "/points.parquet",
        loadModeOf({ load: { mode: "viewport", maxFeatures: 100 } }),
        ["kind"],
        { onData, onError: vi.fn(), onHint, onTooDense }
      );
      await loader.start();
      expect(onData.mock.calls.at(-1)![0].features).toHaveLength(0);
      expect(onTooDense).toHaveBeenLastCalledWith(true);
      expect(onHint).toHaveBeenCalledTimes(1);
      expect(onHint.mock.calls[0]![0]).toContain("more than one read takes (`maxFeatures`: 100)");
      // The footer only.
      expect(log).toHaveLength(1);

      map.zoom = 14;
      map.bounds = [10.0, 42.0, 10.1, 42.08];
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onData.mock.calls.at(-1)![0].features.length).toBeGreaterThan(0));
      expect(onTooDense).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("whole-file guard on rows (ml-37r.16), with a real file", () => {
  it("rows over the limit, bytes well under: not read whole (read by view when the file allows)", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const limits = { warn: 1e6, max: 50e6, maxFeatures: 100 };
    const error = await loadGeoParquetWhole("/points.parquet", "all", { limits }).catch((e) => e);
    expect(error).toBeInstanceOf(WholeFileTooLarge);
    expect(error.features).toBe(400);
    const refused = await loadGeoParquetWhole("/districts.parquet", "all", { limits: { ...limits, maxFeatures: 10 } }).catch(
      (e) => e
    );
    expect(failure(refused)).toMatchObject({ code: "too-large", features: 48 });
  });
});

describe("GeoParquet decode budget on the row groups a view touches (M2)", () => {
  // points.parquet: 400 points in 8 Hilbert-sorted row groups of 50.
  const ONE_GROUP: [number, number, number, number] = [10.0, 42.0, 10.05, 42.02];
  const TWO_GROUPS: [number, number, number, number] = [10.0, 42.06, 10.05, 42.08];

  it("counts the whole row groups a view touches, not just the rows in view", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/points.parquet");
    expect(rowGroupsInView(source, ONE_GROUP)).toEqual({ groups: 1, rows: 50, largest: 50 });
    expect(rowGroupsInView(source, TWO_GROUPS)).toEqual({ groups: 2, rows: 100, largest: 50 });
    expect(rowsInView(source, TWO_GROUPS)).toBeLessThan(20);
    expect(rowGroupsInView(source, [0, 0, 1, 1]).rows).toBe(0);
  });

  it("a view under maxFeatures whose row groups hold more than 3 × maxFeatures rows isn't read; a smaller one is", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const log: Log = [];
      vi.stubGlobal("fetch", fixtureFetch(log));
      const map = fakeMap(14, TWO_GROUPS);
      const onData = vi.fn();
      const onHint = vi.fn();
      const onTooDense = vi.fn();
      const loader = new GeoParquetLoader(
        map as never,
        "/points.parquet",
        loadModeOf({ load: { mode: "viewport", maxFeatures: 20 } }),
        ["kind"],
        { onData, onError: vi.fn(), onHint, onTooDense }
      );
      await loader.start();
      // About 4 features in view, but 100 rows decoded: over the 60-row limit (3 × 20).
      expect(onData.mock.calls.at(-1)![0].features).toHaveLength(0);
      expect(onTooDense).toHaveBeenLastCalledWith(true);
      expect(log).toHaveLength(1); // the footer only
      expect(onHint).toHaveBeenCalledTimes(1);
      const hint = onHint.mock.calls[0]![0] as string;
      expect(hint).toContain("has row groups of up to 50 rows");
      expect(hint).toContain("touches 2 row groups, 100 rows, over this map's decode limit of 60 rows (3 × `maxFeatures`)");
      // Small row groups, loosely packed: a Hilbert sort, not another 10,000-row rewrite.
      expect(hint).toContain("Its row groups are already small, but loosely packed");
      expect(hint).toContain("`uvx --from geoparquet-io==1.7.0 gpio sort hilbert points.parquet points-hilbert.parquet --row-group-size 10000 --add-bbox`");
      expect(hint).not.toContain("rewrite the file with about 10,000-row groups");
      expect(hint).toContain("tylertoo");
      expect(hint).toContain("raise `maxFeatures`");

      map.bounds = ONE_GROUP;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onData.mock.calls.at(-1)![0].features.length).toBeGreaterThan(0));
      expect(onTooDense).toHaveBeenLastCalledWith(false);
      expect(onHint).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The fixture's five levels (row groups of 128, 128 | 128, 128 | 128, 128 | 182, 182 | 200, 200, 200 rows). */
const FIXTURE_LEVELS = [
  { groupStart: 0, groupEnd: 1, rowStart: 0, rowEnd: 256, zoom: 10, gsd: 38.21851414680481 },
  { groupStart: 2, groupEnd: 3, rowStart: 256, rowEnd: 512, zoom: 11, gsd: 19.109257073402404 },
  { groupStart: 4, groupEnd: 5, rowStart: 512, rowEnd: 768, zoom: 12, gsd: 9.554628536701202 },
  { groupStart: 6, groupEnd: 7, rowStart: 768, rowEnd: 1132, zoom: 13, gsd: 4.777314268350601 },
  { groupStart: 8, groupEnd: 10, rowStart: 1132, rowEnd: 1732, zoom: 14, gsd: 2.3886571341753005 },
];

describe("geo:overviews: only the canonical level is read (ml-cnv.21)", () => {
  // tylertoo 0.8.0 (scripts/fixtures/overviews.py): 600 lots at zoom 14, plus
  // coarser copies at zooms 10–13 — 1,732 rows in 11 row groups.
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];
  afterEach(() => overrides.clear());

  it("reads the key: the canonical level's rows and row groups", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    expect(Number(source.metadata.num_rows)).toBe(1732);
    expect(source.info.overviews).toEqual({
      version: "0.2.0",
      mode: "duplicating",
      levels: FIXTURE_LEVELS,
      known: true,
      canonicalLevel: 4,
      canonical: { groupStart: 8, groupEnd: 10, rowStart: 1132, rowEnd: 1732 },
    });
    expect(source.info.rows).toBe(600);
    expect(source.info.rowGroups).toBe(3);
  });

  it("a whole read, mlym emit's decode and classify see each lot once", async () => {
    const fc = await decodeBytes(fixture("lots-overviews.parquet"), "lots-overviews.parquet", { columns: "all" });
    expect(fc.features).toHaveLength(600);
    expect(new Set(fc.features.map((f) => f.properties!["lot"])).size).toBe(600);
    expect(fc.features.every((f) => f.properties!["level"] === 4)).toBe(true);
    vi.stubGlobal("fetch", fixtureFetch());
    const whole = await loadGeoParquetWhole("/lots-overviews.parquet", ["floors"]);
    expect(whole.data!.features).toHaveLength(600);
  });

  it("by view, the estimate, the decode budget and the size guards count the canonical level only", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    expect(rowsInView(source, [9, 41, 11, 43])).toBe(600);
    expect(rowGroupsInView(source, [9, 41, 11, 43])).toMatchObject({ groups: 3, rows: 600 });
    const fc = await readBbox(source, [9, 41, 11, 43], { columns: "all" });
    expect(fc!.features).toHaveLength(600);
    expect(fc!.features.every((f) => f.properties!["level"] === 4)).toBe(true);
    // The canonical level's bytes, not the whole file's.
    const [, decoded] = projectedSize(source, "all");
    let everything = 0;
    for (const group of source.metadata.row_groups) {
      for (const chunk of group.columns) everything += Number(chunk.meta_data?.total_uncompressed_size ?? 0);
    }
    expect(decoded).toBeLessThan(everything * 0.6);
    // The whole-file guard counts 600 rows, not 1,732.
    const limits = { warn: 1e6, max: 50e6, maxFeatures: 1000 };
    const read = await loadGeoParquetWhole("/lots-overviews.parquet", "all", { limits });
    expect(read.data!.features).toHaveLength(600);
  });

  it("the loader by view draws each lot once", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const onData = vi.fn();
    const onHint = vi.fn();
    const loader = new GeoParquetLoader(fakeMap(14, AREA) as never, "/lots-overviews.parquet", loadModeOf({ load: "viewport" }), "all", {
      onData,
      onError: vi.fn(),
      onHint,
    });
    await loader.start();
    expect(onData.mock.calls.at(-1)![0].features).toHaveLength(600);
    expect(onHint).not.toHaveBeenCalled();
  });

  it("an unknown major version: the full-detail level, and the author is told", async () => {
    const bytes = fixture("lots-overviews.parquet").slice();
    const text = new TextDecoder("latin1").decode(bytes);
    const at = text.indexOf('"version":"0.2.0","mode"');
    expect(at).toBeGreaterThan(0);
    bytes.set(new TextEncoder().encode('"version":"1.0.0","mode"'), at);
    overrides.set("lots-v1.parquet", bytes);
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-v1.parquet");
    expect(source.info.overviews).toMatchObject({ version: "1.0.0", known: false, canonical: { rowStart: 1132 } });
    const onData = vi.fn();
    const onHint = vi.fn();
    await new GeoParquetLoader(fakeMap(14, AREA) as never, "/lots-v1.parquet", loadModeOf({}), "all", {
      onData,
      onError: vi.fn(),
      onHint,
    }).start();
    expect(onData.mock.calls.at(-1)![0].features).toHaveLength(600);
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(onHint.mock.calls[0]![0]).toContain("has overviews in a newer format (geo:overviews 1.0.0)");
    expect(onHint.mock.calls[0]![0]).toContain("drawing its full-detail level only");
  });

  it("a key whose levels don't cover the row groups is ignored (plain GeoParquet)", async () => {
    const bytes = fixture("lots-overviews.parquet").slice();
    const text = new TextDecoder("latin1").decode(bytes);
    const at = text.indexOf('"row_group_end":10,');
    expect(at).toBeGreaterThan(0);
    bytes.set(new TextEncoder().encode('"row_group_end":99,'), at);
    overrides.set("lots-bad.parquet", bytes);
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-bad.parquet");
    expect(source.info.overviews).toBeUndefined();
    expect(source.info.rows).toBe(1732);
  });
});

describe("geo:overviews levels: the band for a zoom (ml-cnv.22, 0.10 U1)", () => {
  const ALL: [number, number, number, number] = [9, 41, 11, 43];
  afterEach(() => overrides.clear());

  /** The fixture with one stretch of its `geo:overviews` text replaced by another of the same length. */
  function patched(name: string, from: string, to: string): string {
    expect(to.length).toBe(from.length);
    const bytes = fixture("lots-overviews.parquet").slice();
    const text = new TextDecoder("latin1").decode(bytes);
    const at = text.indexOf(from);
    expect(at).toBeGreaterThan(0);
    bytes.set(new TextEncoder().encode(to), at);
    overrides.set(name, bytes);
    return `/${name}`;
  }

  /** Synthetic overviews: one row group of 100 rows per level, at these zooms (the last canonical). */
  function synthetic(zooms: (number | undefined)[], extra: { gsd?: (number | undefined)[]; mode?: Overviews["mode"] } = {}): Overviews {
    const mode = extra.mode ?? "duplicating";
    const levels = zooms.map((zoom, i) => ({
      groupStart: i,
      groupEnd: i,
      rowStart: i * 100,
      rowEnd: (i + 1) * 100,
      ...(zoom !== undefined ? { zoom } : {}),
      ...(extra.gsd?.[i] !== undefined ? { gsd: extra.gsd[i] } : {}),
    }));
    const last = levels.length - 1;
    return {
      version: "0.2.0",
      mode,
      levels,
      known: true,
      ...(mode === "duplicating"
        ? { canonicalLevel: last, canonical: { groupStart: last, groupEnd: last, rowStart: last * 100, rowEnd: (last + 1) * 100 } }
        : {}),
    };
  }

  it("parseOverviews keeps every level, the canonical one included; geo.overviews in the geo JSON parses the same", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    const overviews = parseOverviews(source.metadata, undefined)!;
    expect(overviews.levels).toEqual(FIXTURE_LEVELS);
    expect(overviews.levels.map((l) => l.zoom)).toEqual([10, 11, 12, 13, 14]);
    expect(overviews.canonicalLevel).toBe(4);
    expect(overviews.canonical).toEqual({ groupStart: 8, groupEnd: 10, rowStart: 1132, rowEnd: 1732 });
    expect(overviews.canonical!.rowEnd - overviews.canonical!.rowStart).toBe(600);
    // The key's planned home: the same object under `geo.overviews`.
    const key = source.metadata.key_value_metadata!.find((kv) => kv.key === "geo:overviews")!.value!;
    const withoutKey = {
      ...source.metadata,
      key_value_metadata: source.metadata.key_value_metadata!.filter((kv) => kv.key !== "geo:overviews"),
    };
    expect(parseOverviews(withoutKey, { overviews: JSON.parse(key) })).toEqual(overviews);
    expect(parseOverviews(withoutKey, undefined)).toBeUndefined();
  });

  it.each([
    [11.4, 1, "z11"],
    [12.0, 2, "z12"],
    [12.99, 2, "z12"],
    [13, 3, "z13"],
    [9.0, 0, "z10 (the coarsest)"],
    [2, 0, "z10 (the coarsest)"],
    [14, 4, "canonical"],
    [15, 4, "canonical"],
  ])("on the fixture, zoom %s reads level %s (%s)", async (zoom, level) => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    const band = overviewBand(source.info.overviews, zoom)!;
    const { groupStart, groupEnd, rowStart, rowEnd } = FIXTURE_LEVELS[level]!;
    expect(band).toMatchObject({ level, groupStart, groupEnd, rowStart, rowEnd });
    expect(band.fallback).toBeUndefined();
  });

  it("AE1: levels at z8, z10, z12 and the canonical level at z14 — 11.4 → z10, 12.0 → z12, 15 → canonical", () => {
    const overviews = synthetic([8, 10, 12, 14]);
    expect(overviewBand(overviews, 11.4)).toMatchObject({ level: 1, groupStart: 1, groupEnd: 1, rowStart: 100, rowEnd: 200 });
    expect(overviewBand(overviews, 12.0)).toMatchObject({ level: 2, rowStart: 200, rowEnd: 300 });
    expect(overviewBand(overviews, 15)).toMatchObject({ level: 3, ...overviews.canonical });
    expect(overviewBand(overviews, 13.9)).toMatchObject({ level: 2 });
    expect(overviewBand(overviews, 7.5)).toMatchObject({ level: 0 });
  });

  it("no band for a file without overviews, or one whose major version this version doesn't know", () => {
    expect(overviewBand(undefined, 12)).toBeUndefined();
    expect(overviewBand({ ...synthetic([8, 10, 12, 14]), version: "1.0.0", known: false }, 12)).toBeUndefined();
  });

  it("a level without zoom gets one from its gsd (the equatorial rule, metres)", () => {
    // gsd for z10 and z12 at 1024-px tiles: 40075016.69 / 1024 / 2^z.
    const gsd = (z: number) => 40075016.69 / 1024 / 2 ** z;
    const overviews = synthetic([8, undefined, undefined, 14], { gsd: [undefined, gsd(10), gsd(12), undefined] });
    expect(overviewBand(overviews, 10)).toMatchObject({ level: 1 });
    expect(overviewBand(overviews, 11.4)).toMatchObject({ level: 1 });
    expect(overviewBand(overviews, 12)).toMatchObject({ level: 2 });
    expect(overviewBand(overviews, 9)).toMatchObject({ level: 0 });
    expect(overviewBand(overviews, 9)!.fallback).toBeUndefined();
  });

  it("the fixture with its zooms removed chooses the same levels from gsd", async () => {
    const url = patched("lots-gsd.parquet", '"zoom":11}', '"zoo_":11}');
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open(url);
    expect(source.info.overviews!.levels[1]!.zoom).toBeUndefined();
    expect(source.info.overviews!.levels[1]!.gsd).toBeCloseTo(19.109, 3);
    expect(overviewBand(source.info.overviews, 11.4)).toMatchObject({ level: 1 });
    expect(overviewBand(source.info.overviews, 10.9)).toMatchObject({ level: 0 });
  });

  it("a level with neither zoom nor gsd: the canonical level, with the reason", async () => {
    const overviews = synthetic([8, undefined, 12, 14]);
    expect(overviewBand(overviews, 9)).toEqual({ level: 3, ...overviews.canonical, fallback: "no-zoom" });
    const url = patched("lots-nozoom.parquet", '"gsd":19.109257073402404,"zoom":11}', '"gs_":19.109257073402404,"zoo_":11}');
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open(url);
    expect(overviewBand(source.info.overviews, 11)).toEqual({
      level: 4,
      groupStart: 8,
      groupEnd: 10,
      rowStart: 1132,
      rowEnd: 1732,
      fallback: "no-zoom",
    });
    // A gsd that isn't a positive number counts as none.
    expect(overviewBand(synthetic([8, 10, 12, undefined], { gsd: [undefined, undefined, undefined, 0] }), 9)).toMatchObject({ fallback: "no-zoom" });
  });

  it("partitioning mode reads every level up to the chosen one", () => {
    const overviews = synthetic([8, 10, 12, 14], { mode: "partitioning" });
    expect(overviews.canonical).toBeUndefined();
    expect(overviewBand(overviews, 11.4)).toEqual({ level: 1, groupStart: 0, groupEnd: 1, rowStart: 0, rowEnd: 200 });
    expect(overviewBand(overviews, 7)).toEqual({ level: 0, groupStart: 0, groupEnd: 0, rowStart: 0, rowEnd: 100 });
    expect(overviewBand(overviews, 16)).toEqual({ level: 3, groupStart: 0, groupEnd: 3, rowStart: 0, rowEnd: 400 });
    // Neither zoom nor gsd somewhere: every row (partitioning has no canonical level).
    expect(overviewBand(synthetic([8, undefined, 12, 14], { mode: "partitioning" }), 9)).toEqual({
      level: 3,
      groupStart: 0,
      groupEnd: 3,
      rowStart: 0,
      rowEnd: 400,
      fallback: "no-zoom",
    });
  });

  it("a partitioning file parses its levels with no canonical level", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    const raw = JSON.parse(source.metadata.key_value_metadata!.find((kv) => kv.key === "geo:overviews")!.value!);
    const metadata = {
      ...source.metadata,
      key_value_metadata: [{ key: "geo:overviews", value: JSON.stringify({ ...raw, mode: "partitioning", canonical_level: null }) }],
    };
    const overviews = parseOverviews(metadata, undefined)!;
    expect(overviews).toMatchObject({ mode: "partitioning", levels: FIXTURE_LEVELS });
    expect(overviews.canonical).toBeUndefined();
    expect(overviews.canonicalLevel).toBeUndefined();
    expect(overviewBand(overviews, 12.5)).toEqual({ level: 2, groupStart: 0, groupEnd: 5, rowStart: 0, rowEnd: 768 });
  });

  it("rowsInView, rowGroupsInView and readBbox with a band touch only that band's row groups", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    const z10 = overviewBand(source.info.overviews, 10)!;
    const z13 = overviewBand(source.info.overviews, 13.2)!;
    expect(rowsInView(source, ALL, z10)).toBe(256);
    expect(rowsInView(source, ALL, z13)).toBe(364);
    expect(rowGroupsInView(source, ALL, z13)).toEqual({ groups: 2, rows: 364, largest: 182 });
    const fc = await readBbox(source, ALL, { columns: "all", band: z10 });
    expect(fc!.features).toHaveLength(256);
    expect(fc!.features.every((f) => f.properties!["level"] === 0)).toBe(true);
    const coarse = await readBbox(source, ALL, { columns: "all", band: z13 });
    expect(coarse!.features.every((f) => f.properties!["level"] === 3)).toBe(true);
    expect(coarse!.features).toHaveLength(364);
    // projectedSize by band counts that band's bytes.
    const [, canonicalDecoded] = projectedSize(source, "all");
    const [, z10Decoded] = projectedSize(source, "all", z10);
    expect(z10Decoded).toBeGreaterThan(0);
    expect(z10Decoded).toBeLessThan(canonicalDecoded);
    // Judged on the band's own row groups: the canonical level's three are
    // compact, the z10 level's two each span over half of its extent.
    expect(canSkipByView(source)).toBe(true);
    expect(canSkipByView(source, source.info.overviews!.canonical)).toBe(true);
    expect(canSkipByView(source, z10)).toBe(false);
  });

  it("without a band, every helper still reads the canonical level (0.9.2)", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    const canonical = source.info.overviews!.canonical!;
    expect(rowsInView(source, ALL)).toBe(rowsInView(source, ALL, canonical));
    expect(rowsInView(source, ALL)).toBe(600);
    expect(rowGroupsInView(source, ALL)).toEqual(rowGroupsInView(source, ALL, canonical));
    expect(projectedSize(source, "all")).toEqual(projectedSize(source, "all", canonical));
    const fc = await readBbox(source, ALL, { columns: "all" });
    expect(fc!.features).toHaveLength(600);
    // A whole read ignores any band: always the canonical level.
    const whole = await readAll(source, { columns: "all" });
    expect(whole!.features).toHaveLength(600);
  });
});

describe("geo:overviews by view: the level for the zoom (ml-cnv.22, 0.10 U2)", () => {
  // lots-overviews.parquet: levels at zooms 10–13 (256, 256, 256, 364 rows)
  // and the canonical level at zoom 14 (600 lots); the `level` column is
  // each row's level index (0–4).
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];
  const FILE = "/lots-overviews.parquet";
  afterEach(() => overrides.clear());

  /**
   * Park every byte read of the loader's open file while `hold()` is in
   * force. (The fixture is smaller than the footer read, so it is in memory
   * after `open` and reads by view fetch nothing: the gate is on the file.)
   */
  function gateFile(instance: GeoParquetLoader) {
    const file = (instance as unknown as { opened: { file: { slice: (s: number, e?: number) => unknown } } }).opened.file;
    const slice = file.slice.bind(file);
    const parked: (() => void)[] = [];
    let holding = false;
    file.slice = (start: number, end?: number) =>
      holding ? new Promise((go) => parked.push(() => go(slice(start, end)))) : slice(start, end);
    return {
      parked: () => parked.length,
      hold: () => {
        holding = true;
      },
      release: () => {
        holding = false;
        parked.splice(0).forEach((go) => go());
      },
    };
  }

  function loader(map: ReturnType<typeof fakeMap>, load: ReturnType<typeof loadModeOf>, limits?: { warn: number; max: number; maxFeatures?: number }) {
    const onData = vi.fn();
    const onHint = vi.fn();
    const onTooDense = vi.fn();
    const onLevelChange = vi.fn();
    const onError = vi.fn();
    const instance = new GeoParquetLoader(
      map as never,
      FILE,
      load,
      ["lot", "level"],
      { onData, onError, onHint, onTooDense, onLevelChange } as never,
      limits
    );
    return { loader: instance, onData, onHint, onTooDense, onLevelChange, onError };
  }

  /** The `level` values of the last delivery, and how many features it had. */
  const last = (onData: ReturnType<typeof vi.fn>) => {
    const fc = onData.mock.calls.at(-1)![0] as FeatureCollectionLike;
    return { n: fc.features.length, levels: [...new Set(fc.features.map((f) => f.properties!["level"]))] };
  };
  type FeatureCollectionLike = { features: { properties: Record<string, unknown> | null }[] };

  it("a switch while a read is in flight: the stale band's read never lands, only the final band's does", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.stubGlobal("fetch", fixtureFetch());
      const map = fakeMap(14, AREA);
      const { loader: l, onData, onLevelChange } = loader(map, loadModeOf({ load: "viewport" }));
      await l.start();
      const gate = gateFile(l);
      expect(last(onData)).toEqual({ n: 600, levels: [4] });
      const delivered = onData.mock.calls.length;

      // Zoom out to 12: its read starts and is held mid-flight.
      gate.hold();
      map.zoom = 12;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(gate.parked()).toBeGreaterThan(0));
      // Zoom out again, to 10, before the zoom-12 read lands.
      map.zoom = 10;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      gate.release();
      await vi.waitFor(() => expect(onData.mock.calls.length).toBe(delivered + 1));
      await vi.advanceTimersByTimeAsync(300);
      // One delivery after the start: the zoom-10 level's, never the zoom-12 one's.
      expect(onData.mock.calls.length).toBe(delivered + 1);
      expect(last(onData)).toEqual({ n: 256, levels: [0] });
      expect(onLevelChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("two level boundaries crossed within the debounce: one read, of the final band", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.stubGlobal("fetch", fixtureFetch());
      const map = fakeMap(14, AREA);
      const { loader: l, onData, onLevelChange } = loader(map, loadModeOf({ load: "viewport" }));
      await l.start();
      const delivered = onData.mock.calls.length;
      map.zoom = 13;
      map.moveend();
      await vi.advanceTimersByTimeAsync(100);
      map.zoom = 12.5;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onData.mock.calls.length).toBe(delivered + 1));
      expect(last(onData)).toEqual({ n: 256, levels: [2] });
      expect(onLevelChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AE1: zoom 10 reads only the zoom-10 level, 12 only zoom 12's, 14 the 600 canonical lots", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.stubGlobal("fetch", fixtureFetch());
      const map = fakeMap(10, AREA);
      const { loader: l, onData, onLevelChange, onHint } = loader(map, loadModeOf({ load: "viewport" }));
      await l.start();
      expect(last(onData)).toEqual({ n: 256, levels: [0] });
      expect(onLevelChange).not.toHaveBeenCalled();
      for (const [zoom, n, level, switches] of [
        [12, 256, 2, 1],
        [12.7, 256, 2, 1],
        [14, 600, 4, 2],
        [16, 600, 4, 2],
        [11.4, 256, 1, 3],
      ] as const) {
        map.zoom = zoom;
        map.moveend();
        await vi.advanceTimersByTimeAsync(300);
        await vi.waitFor(() => expect(last(onData)).toEqual({ n, levels: [level] }));
        expect(onLevelChange).toHaveBeenCalledTimes(switches);
      }
      expect(onHint).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AE2: overviews: false at zoom 10 reads the canonical rows, and the zoom-in line shows when over budget", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const open = loader(fakeMap(10, AREA), loadModeOf({ load: { mode: "viewport", overviews: false } }));
    await open.loader.start();
    expect(last(open.onData)).toEqual({ n: 600, levels: [4] });
    expect(open.loader.minzoom).toBe(10);

    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const dense = loader(fakeMap(10, AREA), loadModeOf({ load: { mode: "viewport", overviews: false, maxFeatures: 300 } }));
    await dense.loader.start();
    expect(last(dense.onData).n).toBe(0);
    expect(dense.onTooDense).toHaveBeenLastCalledWith(true);
    expect(dense.onHint).toHaveBeenCalledTimes(1);
    expect(dense.onHint.mock.calls[0]![0]).toContain("has about 600 features in view, more than one read takes");
    expect(log).toHaveLength(1); // the footer only
  });

  it("AE3: a level over maxFeatures shows the zoom-in line and one too-dense-level hint; no coarser level is read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const log: Log = [];
      vi.stubGlobal("fetch", fixtureFetch(log));
      const map = fakeMap(13, AREA);
      const { loader: l, onData, onHint, onTooDense } = loader(map, loadModeOf({ load: { mode: "viewport", maxFeatures: 300 } }));
      await l.start();
      // Zoom 13's level holds 364 in view: over 300, and the zoom-12 level's 256 is not read instead.
      expect(last(onData).n).toBe(0);
      expect(onTooDense).toHaveBeenLastCalledWith(true);
      expect(log).toHaveLength(1);
      expect(onHint).toHaveBeenCalledTimes(1);
      const [hint, once] = onHint.mock.calls[0]! as [string, string | undefined];
      expect(hint).toContain("`/lots-overviews.parquet` is an overview file");
      expect(hint).toContain("its zoom-13 level still has about 364 features in view");
      expect(hint).toContain("(`maxFeatures`: 300)");
      expect(hint).toContain("a coarser level isn't drawn instead (its coarsest, zoom 10, has about 256 here)");
      expect(hint).toContain("t.overview('source.parquet', 'lots-overviews.parquet', min_zoom=10, max_zoom=14, drop_rate=2.5)");
      // Not the plain dense-view hint (which starts "`…` has about").
      expect(hint).not.toMatch(/^`\/lots-overviews\.parquet` has about/);
      expect(once).toBeTruthy();
      // Out to zoom 12: its level fits, and is read; back in to 13, dense again, no second hint.
      map.zoom = 12;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(last(onData)).toEqual({ n: 256, levels: [2] }));
      expect(onTooDense).toHaveBeenLastCalledWith(false);
      map.zoom = 13.5;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onTooDense).toHaveBeenLastCalledWith(true));
      expect(onHint).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AE3, below every level: the coarsest level too dense — the hint offers levels from the map's zoom", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const { loader: l, onData, onHint, onTooDense } = loader(fakeMap(5.5, AREA), loadModeOf({ load: { mode: "viewport", maxFeatures: 200 } }));
    await l.start();
    expect(last(onData).n).toBe(0);
    expect(onTooDense).toHaveBeenLastCalledWith(true);
    const hint = onHint.mock.calls[0]![0] as string;
    expect(hint).toContain("its zoom-10 level, its coarsest, still has about 256 features in view");
    expect(hint).not.toContain("a coarser level isn't drawn instead");
    expect(hint).toContain(", and levels from zoom 5: ");
    expect(hint).toContain("min_zoom=5, max_zoom=14, drop_rate=2.5");
  });

  it("KTD3: under the whole-file limits with no load: key it is read whole at its canonical level; load: viewport uses levels", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const whole = loader(fakeMap(10, AREA), loadModeOf({}));
    await whole.loader.start();
    expect(whole.loader.readsByView).toBe(false);
    expect(last(whole.onData)).toEqual({ n: 600, levels: [4] });
    expect(whole.onLevelChange).not.toHaveBeenCalled();

    const byView = loader(fakeMap(10, AREA), loadModeOf({ load: "viewport" }));
    await byView.loader.start();
    expect(byView.loader.readsByView).toBe(true);
    expect(last(byView.onData)).toEqual({ n: 256, levels: [0] });
  });

  it("KTD3: over the whole-file limits (counted on canonical rows) with no load: key, it switches to by view and uses levels", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    // 600 canonical rows over a 500-row whole-file limit (1,732 in the file).
    const auto = loader(fakeMap(10, AREA), loadModeOf({}), { warn: 1e6, max: 50e6, maxFeatures: 500 });
    await auto.loader.start();
    expect(auto.onError).not.toHaveBeenCalled();
    expect(auto.loader.readsByView).toBe(true);
    expect(last(auto.onData)).toEqual({ n: 256, levels: [0] });
    // …and 700 is enough to read it whole (the canonical level only).
    const fits = loader(fakeMap(10, AREA), loadModeOf({}), { warn: 1e6, max: 50e6, maxFeatures: 700 });
    await fits.loader.start();
    expect(fits.loader.readsByView).toBe(false);
    expect(last(fits.onData)).toEqual({ n: 600, levels: [4] });
  });

  it("KTD4: with no author minzoom an overview file is read from zoom 0 (its coarsest level); an author minzoom wins", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const log: Log = [];
      vi.stubGlobal("fetch", fixtureFetch(log));
      const wide = loader(fakeMap(5, AREA), loadModeOf({ load: "viewport" }));
      await wide.loader.start();
      expect(wide.loader.minzoom).toBe(0);
      expect(last(wide.onData)).toEqual({ n: 256, levels: [0] });
      expect(wide.loader.zoomThatFits!([10.117, 42.058], 2, 1280, 800)).toBe(2);

      log.length = 0;
      const map = fakeMap(11, AREA);
      const author = loader(map, loadModeOf({ load: { mode: "viewport", minzoom: 12 } }));
      await author.loader.start();
      expect(author.loader.minzoom).toBe(12);
      expect(last(author.onData).n).toBe(0);
      expect(author.onTooDense).toHaveBeenLastCalledWith(true);
      expect(log).toHaveLength(1); // the footer only
      map.zoom = 12;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(last(author.onData)).toEqual({ n: 256, levels: [2] }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("a level with neither zoom nor gsd: the canonical level by view, from the default minzoom, and one hint", async () => {
    const bytes = fixture("lots-overviews.parquet").slice();
    const text = new TextDecoder("latin1").decode(bytes);
    const from = '"gsd":19.109257073402404,"zoom":11}';
    const at = text.indexOf(from);
    expect(at).toBeGreaterThan(0);
    bytes.set(new TextEncoder().encode('"gs_":19.109257073402404,"zoo_":11}'), at);
    overrides.set("lots-overviews.parquet", bytes);
    vi.stubGlobal("fetch", fixtureFetch());
    const l = loader(fakeMap(11, AREA), loadModeOf({ load: "viewport" }));
    await l.loader.start();
    expect(l.loader.minzoom).toBe(10);
    expect(last(l.onData)).toEqual({ n: 600, levels: [4] });
    expect(l.onHint).toHaveBeenCalledTimes(1);
    const [hint, once] = l.onHint.mock.calls[0]! as [string, string | undefined];
    expect(hint).toContain("level 1 declares neither `zoom` nor `gsd`");
    expect(hint).toContain("drawing it at full detail only");
    expect(once).toBeTruthy();
  });
});

describe("LayerManager and an overview GeoParquet read by view (0.10 U2)", () => {
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];

  function overviewMap(zoom: number) {
    const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    const moveend: (() => void)[] = [];
    return {
      sources,
      zoom,
      moveend: () => moveend.forEach((fn) => fn()),
      addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
      getSource: vi.fn((id: string) => sources.get(id)),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      getStyle: vi.fn(() => ({ sources: {} })),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      removeFeatureState: vi.fn(),
      getZoom() {
        return this.zoom;
      },
      getBounds: () => ({ getWest: () => AREA[0], getSouth: () => AREA[1], getEast: () => AREA[2], getNorth: () => AREA[3] }),
      on: vi.fn((type: string, fn: () => void) => {
        if (type === "moveend") moveend.push(fn);
      }),
      off: vi.fn((type: string, fn: () => void) => {
        if (type === "moveend" && moveend.includes(fn)) moveend.splice(moveend.indexOf(fn), 1);
      }),
    };
  }

  const levelsOf = (setData: ReturnType<typeof vi.fn>) =>
    [...new Set((setData.mock.calls.at(-1)![0] as { features: { properties: Record<string, unknown> }[] }).features.map((f) => f.properties["level"]))];

  it("AE8: a level switch resets the source's feature state, once, and is not a document update; promoteId reaches MapLibre", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { LayerManager } = await import("../../src/renderer/layer-manager");
      vi.stubGlobal("fetch", fixtureFetch());
      const map = overviewMap(12);
      const callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn(), onSourceHint: vi.fn() };
      const manager = new LayerManager(map as never, callbacks);
      manager.registerSources({
        lots: { type: "geojson", url: "/lots-overviews.parquet", columns: ["lot", "level"], load: "viewport", promoteId: "lot" },
      });
      await manager.addLayer({ id: "lots", type: "fill", source: "lots" } as never);
      await vi.waitFor(() => expect(callbacks.onDataLoaded).toHaveBeenCalled());
      expect(map.addSource).toHaveBeenCalledWith("lots", expect.objectContaining({ promoteId: "lot" }));
      const setData = map.sources.get("lots")!.setData;
      expect(levelsOf(setData)).toEqual([2]);
      expect(map.removeFeatureState).not.toHaveBeenCalled();

      // A pan within the level: new data, no reset of the source's feature state.
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(setData).toHaveBeenCalledTimes(2));
      expect(map.removeFeatureState).not.toHaveBeenCalled();

      // Zoom in past a level boundary: the zoom-14 level, and the source's feature state reset before it lands.
      map.zoom = 14.2;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(levelsOf(setData)).toEqual([4]));
      expect(map.removeFeatureState).toHaveBeenCalledTimes(1);
      expect(map.removeFeatureState).toHaveBeenCalledWith({ source: "lots" });
      expect(map.removeFeatureState.mock.invocationCallOrder[0]!).toBeLessThan(setData.mock.invocationCallOrder.at(-1)!);
      expect(callbacks.onDataError).not.toHaveBeenCalled();
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a live update changing load.overviews recreates the reader once per change; its hint does not repeat", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { LayerManager } = await import("../../src/renderer/layer-manager");
      vi.stubGlobal("fetch", fixtureFetch());
      const map = overviewMap(13);
      const onSourceHint = vi.fn();
      const callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn(), onSourceHint };
      const manager = new LayerManager(map as never, callbacks);
      const spec = (overviews: boolean) => ({
        type: "geojson",
        url: "/lots-overviews.parquet",
        columns: ["lot", "level"],
        load: { mode: "viewport", maxFeatures: 300, overviews },
      });
      manager.registerSources({ lots: spec(true) });
      await manager.addLayer({ id: "lots", type: "fill", source: "lots" } as never);
      const levelHints = () => onSourceHint.mock.calls.filter(([, m]) => String(m).includes("is an overview file"));
      await vi.waitFor(() => expect(levelHints()).toHaveLength(1));
      const destroy = vi.spyOn(GeoParquetLoader.prototype, "destroy");

      await manager.retargetPipeline("lots", spec(false));
      expect(destroy).toHaveBeenCalledTimes(1);
      // Canonical rows: over budget, the plain dense hint.
      await vi.waitFor(() =>
        expect(onSourceHint.mock.calls.some(([, m]) => String(m).includes("more than one read takes"))).toBe(true)
      );
      await manager.retargetPipeline("lots", spec(true));
      expect(destroy).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(manager.readsByView("lots")).toBe(true));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(levelHints()).toHaveLength(1);
      // The same document again: nothing recreated.
      await manager.retargetPipeline("lots", spec(true));
      expect(destroy).toHaveBeenCalledTimes(2);
      expect(callbacks.onDataError).not.toHaveBeenCalled();
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the 10–50 MB GeoParquet note names only what the file lacks (ml-cnv.35)", () => {
  it("sorted with a bbox column: just load: viewport; unsorted: the sort; no ranges: no load: viewport", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const limits = { warn: 1_000, max: 1e8 };
    const warns = () => (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    await loadGeoParquetWhole("/points.parquet", "all", { limits });
    const sorted = warns().find((w) => w.includes("may take a few seconds"))!;
    expect(sorted).toContain('add "load: viewport" (it has a "bbox" column and sorted row groups)');
    expect(sorted).not.toContain("gpio");
    (console.warn as unknown as { mockClear(): void }).mockClear();
    await loadGeoParquetWhole("/points-zstd.parquet", "all", { limits });
    expect(warns().find((w) => w.includes("may take a few seconds"))).toContain('sort it ("uvx --from geoparquet-io==1.7.0 gpio sort hilbert');
    (console.warn as unknown as { mockClear(): void }).mockClear();
    await loadGeoParquetWhole("/norange/points.parquet", "all", { limits });
    const norange = warns().find((w) => w.includes("may take a few seconds"))!;
    expect(norange).not.toContain("load: viewport");
    expect(norange).toContain('list fewer "columns:"');
  });
});

describe("whole columns for classify breaks on a source read by view (0.10 U3, KTD7/KTD8)", () => {
  // lots-overviews.parquet: `floors` is INT64; the canonical level is rows 1132–1732 (600 lots).
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];
  afterEach(() => overrides.clear());

  it("reads one column of the canonical level, no geometry, int64 as numbers", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    const scanned = await readColumns(source, ["floors"]);
    expect(scanned.features).toHaveLength(600);
    expect(scanned.features.every((f) => f.geometry === null)).toBe(true);
    expect(Object.keys(scanned.features[0]!.properties!)).toEqual(["floors"]);
    expect(scanned.features.every((f) => typeof f.properties!["floors"] === "number")).toBe(true);
    // The same values a whole read of the canonical rows has.
    const whole = await readAll(source, { columns: ["floors"] });
    expect(scanned.features.map((f) => f.properties!["floors"])).toEqual(
      whole!.features.map((f) => f.properties!["floors"])
    );
    // A column the file doesn't have is left out; the file's own names are recorded for the hint.
    const missing = await readColumns(source, ["flors"]);
    expect(missing.features.length).toBeGreaterThan(0);
    expect(missing.features[0]!.properties).toEqual({});
  });

  it("an INT64 field (districts' population) yields numeric breaks, not no data", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/districts.parquet");
    const scanned = await readColumns(source, ["population"]);
    expect(scanned.features).toHaveLength(48);
    const record = withData(resolveClassify({ field: "population", method: "quantile", classes: 3, palette: "Blues" } as never, "fill"), scanned);
    expect(record.stats!.noData).toBe(0);
    expect(record.breaks).toHaveLength(2);
    expect(record.breaks!.every((b) => typeof b === "number" && Number.isFinite(b))).toBe(true);
  });

  it("a column over the 32 MB cap (compressed, canonical level) is not read; field and normalize are counted separately", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const source = await open("/lots-overviews.parquet");
    const floors = columnBytes(source, "floors");
    const lot = columnBytes(source, "lot");
    expect(floors).toBeGreaterThan(0);
    // Each column's canonical row groups only.
    let all = 0;
    for (const group of source.metadata.row_groups) {
      for (const chunk of group.columns) if (chunk.meta_data?.path_in_schema[0] === "floors") all += Number(chunk.meta_data.total_compressed_size);
    }
    expect(floors).toBeLessThan(all);
    // Simulate a footer whose floors column is 20 MB per canonical row group (60 MB): over the cap.
    const canonical = source.info.overviews!.canonical!;
    for (let g = canonical.groupStart; g <= canonical.groupEnd; g++) {
      for (const chunk of source.metadata.row_groups[g]!.columns) {
        if (chunk.meta_data?.path_in_schema[0] === "floors") chunk.meta_data.total_compressed_size = BigInt(20 * 1024 * 1024);
        // lot: 10 MB a group, 30 MB in all — under the cap on its own, though floors + lot is over.
        if (chunk.meta_data?.path_in_schema[0] === "lot") chunk.meta_data.total_compressed_size = BigInt(10 * 1024 * 1024);
      }
    }
    expect(columnBytes(source, "floors")).toBeGreaterThan(COLUMN_SCAN_MAX_BYTES);
    expect(columnBytes(source, "lot")).toBeLessThanOrEqual(COLUMN_SCAN_MAX_BYTES);
    await expect(readColumns(source, ["floors"])).rejects.toThrow(/floors.*60 MB.*32 MB/);
    await expect(readColumns(source, ["lot", "floors"])).rejects.toThrow(/floors/);
    const lots = await readColumns(source, ["lot", "level"]);
    expect(lots.features).toHaveLength(600);
    expect(lot).toBeGreaterThan(0);
  });

  it("the loader reads its columns from the file it already opened (no second footer read), within its columns:", async () => {
    const log: Log = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const loader = new GeoParquetLoader(fakeMap(14, AREA) as never, "/lots-overviews.parquet", loadModeOf({ load: "viewport" }), ["lot", "floors"], {
      onData: vi.fn(),
      onError: vi.fn(),
    });
    await loader.start();
    const requests = log.length;
    const scanned = await loader.readColumns(["floors"]);
    expect(scanned.features).toHaveLength(600);
    expect(log.length).toBe(requests);
    // A column columns: leaves out is not read (the view's features don't carry it either).
    const unread = await loader.readColumns(["level"]);
    expect(unread.features[0]!.properties).toEqual({});
  });

  it("AE4: by view across zooms, pans and a level switch, quantile breaks stay those of the whole canonical column", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { LayerManager } = await import("../../src/renderer/layer-manager");
      vi.stubGlobal("fetch", fixtureFetch());
      const moveend: Array<() => void> = [];
      const view = { zoom: 10, bounds: AREA };
      const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
      const added = new Set<string>();
      const map = {
        addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
        getSource: vi.fn((id: string) => sources.get(id)),
        addLayer: vi.fn((l: { id: string }) => added.add(l.id)),
        getLayer: vi.fn((id: string) => (added.has(id) ? { id } : undefined)),
        getStyle: vi.fn(() => ({ sources: {} })),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        removeFeatureState: vi.fn(),
        setPaintProperty: vi.fn(),
        getZoom: () => view.zoom,
        getBounds: () => {
          const [w, s, e, n] = view.bounds;
          return { getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n };
        },
        on: vi.fn((event: string, fn: () => void) => {
          if (event === "moveend") moveend.push(fn);
        }),
        off: vi.fn(),
      };
      let runtime: ClassifyRuntime | undefined;
      const callbacks = {
        onDataLoading: vi.fn(),
        onDataLoaded: vi.fn((id: string) => runtime?.dataLoaded(id)),
        onDataError: vi.fn(),
      };
      const manager = new LayerManager(map as never, callbacks);
      const spec = { type: "geojson", url: "/lots-overviews.parquet", columns: ["lot", "level", "floors"], load: "viewport" };
      manager.registerSources({ lots: spec } as never);
      const record = resolveClassify({ field: "floors", method: "quantile", classes: 4, palette: "Blues" } as never, "fill");
      const layer = applyClassifyToSpec({ id: "lots", type: "fill", source: "lots" }, record) as never;
      const onRefused = vi.fn();
      const changed = vi.fn();
      runtime = new ClassifyRuntime(map as never, [layer], { lots: spec }, (id) => manager.getSourceData(id), changed, {
        readsByView: (id) => manager.readsByView(id),
        wholeColumn: (id, fields) => manager.wholeColumns(id, fields),
        onRefused,
      });
      await manager.addLayer(layer);
      await vi.waitFor(() => expect(changed).toHaveBeenCalled());
      const first = classifyRecordOf(layer)!;
      // The breaks of a whole read of the canonical rows.
      const whole = await decodeBytes(fixture("lots-overviews.parquet"), "lots.parquet", { columns: ["floors"] });
      expect(whole.features).toHaveLength(600);
      expect(first.breaks).toEqual(withData(record, whole).breaks);
      expect(first.stats).toEqual(withData(record, whole).stats);
      // Pan and zoom across the levels (10 → 12 → 14 → a pan): the breaks never move.
      for (const [zoom, bounds] of [
        [12, AREA],
        [14, AREA],
        [14, [10.1, 42.05, 10.2, 42.1]],
        [11, AREA],
      ] as const) {
        view.zoom = zoom;
        view.bounds = bounds as never;
        const delivered = callbacks.onDataLoaded.mock.calls.length;
        moveend.forEach((fn) => fn());
        await vi.advanceTimersByTimeAsync(300);
        await vi.waitFor(() => expect(callbacks.onDataLoaded.mock.calls.length).toBeGreaterThan(delivered));
        expect(classifyRecordOf(layer)!.breaks).toEqual(first.breaks);
        expect(classifyRecordOf(layer)!.stats).toEqual(first.stats);
      }
      expect(map.removeFeatureState).toHaveBeenCalled(); // a level switch happened
      expect(changed).toHaveBeenCalledTimes(1);
      expect(onRefused).not.toHaveBeenCalled();
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
