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
import {
  open,
  openBytes,
  decodeBytes,
  readAll,
  readBbox,
  projectedBytes,
  canSkipByView,
  TAIL_BYTES,
} from "../../src/formats/geoparquet";
import { getDecoder, hasDecoder } from "../../src/formats/decoders";
import { decodeGeoParquet } from "../../src/index";
import { isFormatError } from "../../src/formats/errors";
import {
  GeoParquetLoader,
  loadGeoParquetWhole,
  loadModeOf,
  cloudSourceDataLoader,
  WholeFileTooLarge,
} from "../../src/renderer/cloud-sources";
import { loadSourceData } from "../../src/data/source-data";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/public/gallery-assets/cloud-native"
);
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

type Log = { url: string; range?: string; method?: string; status: number; bytes: number }[];

/**
 * A fetch over the fixtures, honouring HTTP ranges (suffix ranges too) like
 * the e2e server, with its hosting prefixes:
 *
 * - `/norange/<file>`: `Range` ignored, 200 with the whole file;
 * - `/suffix416/<file>`: a suffix longer than the file is 416 (Fastly);
 * - `/noexpose/<file>`: `Content-Range` unreadable, as a page on another
 *   origin sees GitHub Pages (`Content-Length` stays readable);
 * - `/nolength/<file>`: no `Content-Length` (a chunked response).
 *
 * `HEAD` answers with the size. 404 for anything else.
 */
function fixtureFetch(log: Log = []) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const m = /^(?:https?:\/\/[^/]+)?((?:\/(?:norange|suffix416|noexpose|nolength))*)\/(.+)$/.exec(url)!;
    const ranges = !m[1]!.includes("/norange");
    const suffix416 = m[1]!.includes("/suffix416");
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
    options: { load?: ReturnType<typeof loadModeOf>; map?: ReturnType<typeof fakeMap>; columns?: readonly string[] | "all"; limits?: { warn: number; max: number } } = {}
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
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("zoom in to see its features"));
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

  it("load: viewport on a file without a covering column → says so", async () => {
    const { onError } = await run("/districts-nobbox.parquet", { load: loadModeOf({ load: "viewport" }) });
    expect(failure(onError.mock.calls[0]![0])?.code).toBe("no-index");
  });

  it("too large to load whole + sorted → read by view (with a console note)", async () => {
    const { onData, onError, loader } = await run("/points.parquet", { limits: { warn: 1_000, max: 10_000 } });
    expect(onError).not.toHaveBeenCalled();
    expect(loader.readsByView).toBe(true);
    expect(onData).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("reading only the part in view"));
  });

  it("too large to load whole + not readable by view → refused, with the size", async () => {
    const { onError } = await run("/districts.parquet", { limits: { warn: 1_000, max: 2_000 } });
    expect(failure(onError.mock.calls[0]![0])).toMatchObject({ code: "too-large", size: expect.any(Number) });
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("reading only the part in view"));
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
