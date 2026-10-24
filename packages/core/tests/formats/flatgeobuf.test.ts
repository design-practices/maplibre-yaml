// @vitest-environment node
// (jsdom's fetch globals drop a `Range` request header; Node's keep it.)
/**
 * FlatGeobuf (0.9, ml-cnv.3): decoding, the whole-file vs by-view reads, the
 * size guards and the failure classes — against the committed fixtures
 * (scripts/fixtures/cloud-native.py), served by a stub `fetch` that honours
 * (or, under /norange/, ignores) HTTP ranges like the e2e server does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBytes, probe, openWhole, decodeStream, isLonLat, readIndexLevel } from "../../src/formats/flatgeobuf";
import { isFormatError } from "../../src/formats/errors";
import {
  FlatGeobufLoader,
  loadModeOf,
  loadFlatGeobufWhole,
  cloudSourceDataLoader,
  WholeFileTooLarge,
  VIEWPORT_DEFAULT_MINZOOM,
  VIEWPORT_DEFAULT_MAX_FEATURES,
} from "../../src/renderer/cloud-sources";
import { loadSourceData } from "../../src/data/source-data";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/public/gallery-assets/cloud-native"
);
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** A fetch over the fixtures: `/<file>`, `/norange/<file>`, `/oversize/<MB>/<file>`, 404 otherwise. */
function fixtureFetch(log: { url: string; range?: string; status: number }[] = []) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const m = /^(?:https?:\/\/[^/]+)?(\/norange|\/oversize\/(\d+))?\/(.+)$/.exec(url)!;
    const ranges = m[1] !== "/norange";
    const padMb = m[2] ? Number(m[2]) : 0;
    let bytes: Uint8Array;
    try {
      bytes = fixture(m[3]!);
    } catch {
      log.push({ url, status: 404 });
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    const size = Math.max(bytes.length, padMb * 1024 * 1024);
    const headers = new Headers(init?.headers ?? {});
    const range = headers.get("Range");
    const r = range && ranges ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (r) {
      const start = Number(r[1]);
      const end = Math.min(Number(r[2]), size - 1);
      const body = new Uint8Array(end - start + 1);
      body.set(bytes.subarray(start, Math.min(bytes.length, end + 1)));
      log.push({ url, range: range!, status: 206 });
      return new Response(body, {
        status: 206,
        headers: { "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(body.length) },
      });
    }
    log.push({ url, status: 200 });
    // Padded bodies are never read whole by the code under test: stream just the file.
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

const REPO_ROOT_FOR_ZSTD = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("decodeBytes", () => {
  it("decodes every feature with its properties", async () => {
    const fc = await decodeBytes(fixture("districts.fgb"), "districts.fgb");
    expect(fc.features).toHaveLength(48);
    expect(fc.features[0]!.geometry.type).toBe("Polygon");
    expect(fc.features[0]!.properties).toMatchObject({ name: expect.stringMatching(/^District /) });
  });

  it("refuses projected data with the reprojection command", async () => {
    const error = await decodeBytes(fixture("districts-3857.fgb"), "districts-3857.fgb").catch((e) => e);
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "crs", crs: "EPSG:3857" });
  });

  it("names a Zstandard-compressed file instead of 'not a FlatGeobuf file' (ml-aot.109)", async () => {
    const zstd = new Uint8Array(readFileSync(join(REPO_ROOT_FOR_ZSTD, "examples/verification/data/districts-zstd.fgb")));
    const error = await decodeBytes(zstd, "districts-zstd.fgb").catch((e) => e);
    expect(isFormatError(error) && error.failure.code).toBe("compressed");
    expect((error as Error).message).toContain("is compressed (Zstandard)");
    expect((error as Error).message).toContain("zstd -d districts-zstd.fgb");
  });

  it("calls a web page what it is", async () => {
    const error = await decodeBytes(fixture("not-really.fgb"), "not-really.fgb").catch((e) => e);
    expect(isFormatError(error) && error.failure.code).toBe("not-format");
  });
});

describe("isLonLat: which CRS a header declares", () => {
  const head = (code: number | undefined, envelope?: [number, number, number, number]) => ({
    header: { featuresCount: 1, indexed: true, ...(envelope ? { envelope } : {}) },
    raw: code !== undefined ? { crs: { org: "EPSG", code } } : {},
  });
  const LONLAT: [number, number, number, number] = [10, 42, 10.5, 42.3];
  const METRES: [number, number, number, number] = [1113194, 5160979, 1168854, 5206000];

  it("accepts known geographic codes outside the old hard-coded list", () => {
    for (const code of [4167, 4490, 4612, 6668, 7844, 4979, 4937, 4230, 4277]) {
      const { header, raw } = head(code, LONLAT);
      expect(isLonLat(header, raw), `EPSG:${code}`).toBe(true);
    }
  });

  it("decides an unknown code by the envelope", () => {
    const inside = head(9999, LONLAT);
    expect(isLonLat(inside.header, inside.raw)).toBe(true);
    const outside = head(9999, METRES);
    expect(isLonLat(outside.header, outside.raw)).toBe(false);
  });

  it("still refuses known projected codes, even with a small extent", () => {
    for (const code of [3857, 900913, 32633, 25832]) {
      const { header, raw } = head(code, [0.1, 0.1, 0.2, 0.2]);
      expect(isLonLat(header, raw), `EPSG:${code}`).toBe(false);
    }
  });

  it("a geographic code with a projected-looking extent is refused (mislabelled file)", () => {
    const { header, raw } = head(4326, METRES);
    expect(isLonLat(header, raw)).toBe(false);
  });
});

describe("probe / openWhole", () => {
  it("probe: ranges, size and magic in one 8-byte request", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    await expect(probe("/points.fgb")).resolves.toEqual({
      ranges: true,
      size: fixture("points.fgb").length,
    });
    await expect(probe("/norange/points.fgb")).resolves.toMatchObject({ ranges: false });
    const notFgb = await probe("/not-really.fgb").catch((e) => e);
    expect(isFormatError(notFgb) && notFgb.failure.code).toBe("not-format");
  });

  it("a 404 is thrown in the GeoJSON fetcher's shape (same notice wording)", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await openWhole("/missing.fgb").catch((e) => e);
    expect(error.message).toBe("HTTP 404: Not Found for /missing.fgb");
    expect(error.url).toBe("/missing.fgb");
  });

  it("a refused fetch (CORS / unreachable) is classified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const error = await openWhole("https://elsewhere.example/a.fgb").catch((e) => e);
    expect(isFormatError(error) && error.failure.code).toBe("cors");
  });

  it("decodeStream reads a whole response", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const opened = await openWhole("/points.fgb");
    const fc = await decodeStream(opened, "/points.fgb");
    expect(fc!.features).toHaveLength(400);
  });
});

describe("the fitTo prefetch seam (data/source-data, ml-aot.75)", () => {
  const ctx = { fetcher: { fetch: vi.fn() } as never };

  it("a FlatGeobuf source read whole is loaded ahead and decoded, not fetched as JSON", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const fc = await loadSourceData({ type: "geojson", url: "/districts.fgb" }, ctx);
    expect(fc.features).toHaveLength(48);
  });

  it("a viewport source is not loaded ahead", async () => {
    await expect(cloudSourceDataLoader({ type: "geojson", url: "/p.fgb", load: "viewport" }, ctx)).rejects.toThrow(
      /not loaded ahead/
    );
    expect(cloudSourceDataLoader({ type: "geojson", url: "/p.geojson" }, ctx)).toBeUndefined();
  });

  it("an oversized file rejects with its size, so the reader can switch to the view", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await loadFlatGeobufWhole("/oversize/60/points.fgb").catch((e) => e);
    expect(error).toBeInstanceOf(WholeFileTooLarge);
    expect(error.size).toBe(60 * 1024 * 1024);
  });
});

describe("a host that answers ranges from a compressed copy (ml-zm7)", () => {
  it("probe: bytes that aren't the file, from a host that serves it compressed, are said for what they are", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: string, init?: RequestInit) =>
        init?.method === "HEAD"
          ? new Response(null, { status: 200, headers: { "content-encoding": "br" } })
          : new Response(new Uint8Array([27, 7, 234, 17, 213, 188, 30, 34]), {
              status: 206,
              headers: { "content-range": "bytes 0-7/13862" },
            })
      )
    );
    const error = await probe("https://cdn.example/points.fgb").catch((e) => e);
    expect(isFormatError(error) && error.failure.code).toBe("encoded-range");
    expect((error as Error).message).toContain("fastly.jsdelivr.net, not cdn.jsdelivr.net");
  });

  it("…while a web page under a .fgb name is still 'isn't a FlatGeobuf file'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: string, init?: RequestInit) =>
        init?.method === "HEAD"
          ? new Response(null, { status: 200 })
          : new Response(new TextEncoder().encode("<!doctype"), { status: 206 })
      )
    );
    const error = await probe("https://h.example/x.fgb").catch((e) => e);
    expect(isFormatError(error) && error.failure.code).toBe("not-format");
  });
});

describe("the whole-file guard without Content-Length (ml-cnv.19)", () => {
  /** points.fgb (60 KB) as a chunked response: 4 KB at a time, no Content-Length. */
  const chunked = () =>
    vi.fn(async () => {
      const bytes = fixture("points.fgb");
      let at = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= bytes.length) return controller.close();
          controller.enqueue(bytes.slice(at, (at += 4096)));
        },
      });
      return new Response(body, { status: 200 });
    });

  it("stops once the bytes streamed pass the guard, so the reader can switch to the view", async () => {
    vi.stubGlobal("fetch", chunked());
    const error = await loadFlatGeobufWhole("/points.fgb", { limits: { warn: 10_000, max: 20_000 } }).catch((e) => e);
    expect(error).toBeInstanceOf(WholeFileTooLarge);
    expect(error.size).toBeGreaterThan(20_000);
    expect(error.size).toBeLessThan(fixture("points.fgb").length);
  });

  it("a file under the guard still decodes", async () => {
    vi.stubGlobal("fetch", chunked());
    const fc = await loadFlatGeobufWhole("/points.fgb", { limits: { warn: 1e6, max: 2e6 } });
    expect(fc!.features.length).toBeGreaterThan(100);
  });
});

describe("loadModeOf", () => {
  it("normalizes load:", () => {
    const max = VIEWPORT_DEFAULT_MAX_FEATURES;
    expect(loadModeOf({})).toEqual({ mode: "all", minzoom: VIEWPORT_DEFAULT_MINZOOM, maxFeatures: max });
    expect(loadModeOf({ load: "viewport" })).toEqual({ mode: "viewport", minzoom: 10, maxFeatures: max });
    expect(loadModeOf({ load: { mode: "viewport", minzoom: 13 } })).toEqual({
      mode: "viewport",
      minzoom: 13,
      maxFeatures: max,
    });
    expect(loadModeOf({ load: { mode: "all" } }).mode).toBe("all");
    // The per-view budget (ml-37r.17), flat or under a v2 source's runtime:.
    expect(loadModeOf({ load: { mode: "viewport", maxFeatures: 5000 } }).maxFeatures).toBe(5000);
    expect(loadModeOf({ runtime: { load: { mode: "viewport", maxFeatures: 7 } } }).maxFeatures).toBe(7);
  });
});

describe("FlatGeobufLoader", () => {
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];

  async function run(url: string, load = loadModeOf({}), map = fakeMap(12, AREA)) {
    const log: { url: string; range?: string; status: number }[] = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const onData = vi.fn();
    const onError = vi.fn();
    const loader = new FlatGeobufLoader(map as never, url, load, { onData, onError });
    await loader.start();
    return { loader, onData, onError, log, map };
  }

  it("load: all — one whole-file GET, every feature", async () => {
    const { onData, onError, log, loader } = await run("/points.fgb");
    expect(onError).not.toHaveBeenCalled();
    expect(onData.mock.calls[0]![0].features).toHaveLength(400);
    expect(log.map((r) => r.status)).toEqual([200]);
    expect(loader.readsByView).toBe(false);
  });

  it("load: viewport — only the features in view, by range requests", async () => {
    const view: [number, number, number, number] = [10.0, 42.0, 10.1, 42.08];
    const { onData, log, loader } = await run("/points.fgb", loadModeOf({ load: "viewport" }), fakeMap(12, view));
    const fc = onData.mock.calls.at(-1)![0];
    expect(fc.features.length).toBeGreaterThan(0);
    expect(fc.features.length).toBeLessThan(400);
    for (const f of fc.features) {
      const [x, y] = f.geometry.coordinates;
      expect(x >= view[0] && x <= view[2] && y >= view[1] && y <= view[3]).toBe(true);
    }
    expect(log.every((r) => r.status === 206)).toBe(true);
    expect(loader.readsByView).toBe(true);
    // fitTo frames the whole file, from its header.
    const [[w, s], [e, n]] = loader.extent!;
    expect(w).toBeCloseTo(10.0, 1);
    expect(s).toBeCloseTo(42.0, 1);
    expect(e).toBeCloseTo(10.4, 1);
    expect(n).toBeCloseTo(42.3, 1);
  });

  it("load: viewport below minzoom — empty, and re-read when the map moves in", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const map = fakeMap(9, AREA);
      const { onData } = await run("/points.fgb", loadModeOf({ load: { mode: "viewport", minzoom: 11 } }), map);
      expect(onData.mock.calls.at(-1)![0].features).toHaveLength(0);
      map.zoom = 12;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onData.mock.calls.at(-1)![0].features.length).toBeGreaterThan(0));
    } finally {
      vi.useRealTimers();
    }
  });

  it("below minzoom the reader is asked to zoom in, as for a view too dense to read (M1)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.stubGlobal("fetch", fixtureFetch());
      const map = fakeMap(9, AREA);
      const onData = vi.fn();
      const onTooDense = vi.fn();
      const loader = new FlatGeobufLoader(map as never, "/points.fgb", loadModeOf({ load: { mode: "viewport", minzoom: 11 } }), {
        onData,
        onError: vi.fn(),
        onTooDense,
      });
      await loader.start();
      expect(loader.minzoom).toBe(11);
      expect(onData.mock.calls.at(-1)![0].features).toHaveLength(0);
      expect(onTooDense).toHaveBeenCalledTimes(1);
      expect(onTooDense).toHaveBeenLastCalledWith(true);
      // Panning out there doesn't repeat it.
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      expect(onTooDense).toHaveBeenCalledTimes(1);
      map.zoom = 12;
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onData.mock.calls.at(-1)![0].features.length).toBeGreaterThan(0));
      expect(onTooDense).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("load: viewport on a server without ranges reads the whole file instead", async () => {
    const { onData, onError } = await run("/norange/points.fgb", loadModeOf({ load: "viewport" }));
    expect(onError).not.toHaveBeenCalled();
    expect(onData.mock.calls[0]![0].features).toHaveLength(400);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("doesn't support range requests"));
  });

  it("too large to load whole + indexed → read by view (with a console note)", async () => {
    const { onData, onError, loader } = await run("/oversize/60/points.fgb");
    expect(onError).not.toHaveBeenCalled();
    expect(loader.readsByView).toBe(true);
    expect(onData).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("too large to load whole"));
  });

  it("too large to load whole + no index → refused, with the size", async () => {
    const { onError } = await run("/oversize/60/points-noindex.fgb");
    const error = onError.mock.calls[0]![0];
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "too-large", size: 60 * 1024 * 1024 });
    // No console note promising a by-view read that is then refused (ml-aot.103).
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("reading only the part in view"));
  });

  it("load: viewport on a file without an index → says so", async () => {
    const { onError } = await run("/points-noindex.fgb", loadModeOf({ load: "viewport" }));
    expect(isFormatError(onError.mock.calls[0]![0]) && onError.mock.calls[0]![0].failure.code).toBe("no-index");
  });

  it("reuses a whole-file load the host already started (no second request)", async () => {
    const log: { url: string; status: number }[] = [];
    vi.stubGlobal("fetch", fixtureFetch(log));
    const started = Promise.resolve({ type: "FeatureCollection" as const, features: [] });
    const onData = vi.fn();
    const loader = new FlatGeobufLoader(fakeMap(12, AREA) as never, "/points.fgb", loadModeOf({}), {
      onData,
      onError: vi.fn(),
    });
    await loader.start(started);
    expect(onData).toHaveBeenCalledWith({ type: "FeatureCollection", features: [] });
    expect(log).toEqual([]);
  });

  it("destroy() stops further reads and callbacks", async () => {
    const map = fakeMap(12, AREA);
    const { onData, loader } = await run("/points.fgb", loadModeOf({ load: "viewport" }), map);
    const calls = onData.mock.calls.length;
    loader.destroy();
    map.moveend();
    await new Promise((r) => setTimeout(r, 300));
    expect(onData.mock.calls.length).toBe(calls);
  });
});

describe("whole-file guard on the header's feature count (ml-37r.16)", () => {
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];

  it("a file over the feature limit isn't decoded: indexed → read by view, with the count in the note", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const error = await loadFlatGeobufWhole("/points.fgb", { limits: { warn: 1e6, max: 2e6, maxFeatures: 100 } }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(WholeFileTooLarge);
    expect(error.features).toBe(400);

    const onData = vi.fn();
    const onError = vi.fn();
    const loader = new FlatGeobufLoader(fakeMap(12, AREA) as never, "/points.fgb", loadModeOf({}), { onData, onError }, {
      warn: 1e6,
      max: 2e6,
      maxFeatures: 100,
    });
    await loader.start();
    expect(onError).not.toHaveBeenCalled();
    expect(loader.readsByView).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("(400 features) is too large to load whole"));
  });

  it("unindexed and over the feature limit → refused with the count, in plain words", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const onError = vi.fn();
    const loader = new FlatGeobufLoader(
      fakeMap(12, AREA) as never,
      "/points-noindex.fgb",
      loadModeOf({}),
      { onData: vi.fn(), onError },
      { warn: 1e6, max: 2e6, maxFeatures: 100 }
    );
    await loader.start();
    const error = onError.mock.calls[0]![0];
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "too-large", features: 400 });
    expect(error.message).toContain("has 400 features, too large to load whole in a browser");
    expect(error.message).toContain("`load: viewport`");
    expect(error.message).toContain("PMTiles");
  });

  it("a compressed response's Content-Length isn't taken for the file's size", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { headers: { "content-length": "1000", "content-encoding": "gzip" } }))
    );
    expect((await openWhole("/f.fgb")).size).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { headers: { "content-length": "1000" } })));
    expect((await openWhole("/f.fgb")).size).toBe(1000);
  });
});

describe("per-view budget (ml-37r.17)", () => {
  const AREA: [number, number, number, number] = [10.0, 42.0, 10.4, 42.3];

  it("the index estimates a view's features before reading any", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const inView = await readIndexLevel("/points.fgb", {
      featuresCount: 400,
      indexed: true,
      nodeSize: 16,
    });
    const whole = inView([9, 41, 11, 43]);
    expect(whole).toBeCloseTo(400, 0);
    // A quarter of the area holds about a quarter of the (uniform) points —
    // and exactly the ones there, since this small index is read to its leaves.
    const corner: [number, number, number, number] = [10.0, 42.0, 10.2, 42.15];
    const actual = pointCoords.filter(([x, y]) => x >= corner[0] && x <= corner[2] && y >= corner[1] && y <= corner[3]).length;
    expect(Math.round(inView(corner))).toBe(actual);
    expect(inView([0, 0, 1, 1])).toBe(0);
  });

  /** The fixture's point coordinates. */
  let pointCoords: [number, number][] = [];
  beforeEach(async () => {
    pointCoords = (await decodeBytes(fixture("points.fgb"), "points.fgb")).features.map(
      (f) => (f.geometry as { coordinates: [number, number] }).coordinates
    );
  });

  it("a view over the budget isn't read: no features, one author hint, the reader told to zoom in — until a view fits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const log: { url: string; range?: string; status: number }[] = [];
      vi.stubGlobal("fetch", fixtureFetch(log));
      const map = fakeMap(12, AREA);
      const onData = vi.fn();
      const onHint = vi.fn();
      const onTooDense = vi.fn();
      const loader = new FlatGeobufLoader(map as never, "/points.fgb", loadModeOf({ load: { mode: "viewport", maxFeatures: 50 } }), {
        onData,
        onError: vi.fn(),
        onHint,
        onTooDense,
      });
      await loader.start();
      expect(onData.mock.calls.at(-1)![0].features).toHaveLength(0);
      expect(onTooDense).toHaveBeenLastCalledWith(true);
      expect(onHint).toHaveBeenCalledTimes(1);
      expect(onHint.mock.calls[0]![0]).toMatch(/has about 4\d\d features in view, over `maxFeatures` \(50\)/);
      // Only the probe, the header and the index were fetched: no features.
      const fetched = log.reduce((sum, r) => {
        const m = /bytes=(\d+)-(\d+)/.exec(r.range ?? "");
        return sum + (m ? Number(m[2]) - Number(m[1]) + 1 : 0);
      }, 0);
      expect(fetched).toBeLessThan(fixture("points.fgb").length / 2);

      // Still too dense after a pan: no new hint, no new empty delivery.
      const deliveries = onData.mock.calls.length;
      map.bounds = [10.05, 42.0, 10.4, 42.3];
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      expect(onHint).toHaveBeenCalledTimes(1);
      expect(onData.mock.calls.length).toBe(deliveries);

      // Zoomed in to a view that fits: read, and the reader's line goes away.
      map.zoom = 14;
      map.bounds = [10.0, 42.0, 10.05, 42.04];
      map.moveend();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onData.mock.calls.at(-1)![0].features.length).toBeGreaterThan(0));
      expect(onData.mock.calls.at(-1)![0].features.length).toBeLessThanOrEqual(50);
      expect(onTooDense).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the default budget lets an ordinary view through", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const onData = vi.fn();
    const onTooDense = vi.fn();
    const loader = new FlatGeobufLoader(fakeMap(12, AREA) as never, "/points.fgb", loadModeOf({ load: "viewport" }), {
      onData,
      onError: vi.fn(),
      onTooDense,
    });
    await loader.start();
    expect(onData.mock.calls.at(-1)![0].features).toHaveLength(400);
    expect(onTooDense).not.toHaveBeenCalled();
  });
});
