/**
 * The FlatGeobuf and GeoParquet data providers are in their readers'
 * on-demand chunks (bundle headroom U5): `LayerManager` takes them from the
 * chunk. While it downloads, the file's first request is already on its way
 * (the two overlap, one request each); a manager destroyed — or a source
 * removed — meanwhile starts no reader and cancels that request; a failed
 * download is the source's plain notice, and the next load asks again; a
 * `pause()` meanwhile starts the reader suspended.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("maplibre-gl", () => {
  const gl = { config: { REGISTERED_PROTOCOLS: {} }, addProtocol: () => {}, removeProtocol: () => {}, getVersion: () => "6.12.0" };
  return { default: gl, ...gl };
});

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/public/gallery-assets/cloud-native");
const fgb = new Uint8Array(readFileSync(join(FIXTURES, "districts.fgb")));
const parquet = new Uint8Array(readFileSync(join(FIXTURES, "districts.parquet")));
const FGB = "https://h.org/districts.fgb";
const PARQUET = "https://h.org/districts.parquet";
const FGB_LIB = "../../src/formats/lib/flatgeobuf";
const GP_LIB = "../../src/formats/lib/geoparquet";

/** Let every settled promise continuation run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
}

/**
 * A fresh module graph whose reader chunk for `lib` is held until the test
 * releases it — or fails to download.
 */
async function heldChunk(lib: string) {
  vi.resetModules();
  let release!: () => void;
  let fail!: () => void;
  const held = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = () => reject(new TypeError("Failed to fetch dynamically imported module: https://h.org/js/chunks/flatgeobuf.js"));
  });
  held.catch(() => undefined);
  const log: string[] = [];
  vi.doMock(lib, async (importOriginal) => {
    await held;
    log.push("chunk");
    return importOriginal();
  });
  const { LayerManager } = await import("../../src/renderer/layer-manager");
  return { LayerManager, release, fail, log };
}

/** A fetch that serves `bytes` (ranges too), logging each request; `signal`s recorded. */
function serving(bytes: Uint8Array, log: string[]) {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      const range = (init?.headers as Record<string, string> | undefined)?.["Range"];
      log.push(range ? `file ${range}` : "file");
      const m = range && /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : Math.max(0, bytes.length - Number(m[2]));
        const end = m[1] && m[2] ? Number(m[2]) + 1 : bytes.length;
        const part = bytes.slice(start, end);
        return new Response(part, {
          status: 206,
          headers: { "content-range": `bytes ${start}-${end - 1}/${bytes.length}`, "content-length": String(part.length) },
        });
      }
      return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
    })
  );
  return signals;
}

function mockMap() {
  const setData = vi.fn();
  const added = new Set<string>();
  return {
    setData,
    map: {
      addSource: vi.fn((id: string) => added.add(id)),
      getSource: vi.fn((id: string) => (added.has(id) ? { setData } : undefined)),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      getZoom: () => 12,
      getBounds: () => ({ getWest: () => 9, getEast: () => 11, getSouth: () => 41, getNorth: () => 43 }),
      on: vi.fn(),
      off: vi.fn(),
    },
  };
}

const callbacksFor = () => ({ onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn() });

afterEach(() => {
  vi.doUnmock(FGB_LIB);
  vi.doUnmock(GP_LIB);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("LayerManager takes the cloud readers from their chunks (bundle headroom U5)", () => {
  it("a FlatGeobuf file's GET starts before its chunk arrives, and the reader reads that response (one request)", async () => {
    const { LayerManager, release, log } = await heldChunk(FGB_LIB);
    serving(fgb, log);
    const { map, setData } = mockMap();
    const callbacks = callbacksFor();
    const manager = new LayerManager(map as never, callbacks);
    const added = manager.addLayer({ id: "d", type: "fill", source: { type: "geojson", url: FGB } } as never);
    await flush();
    expect(log).toEqual(["file"]);
    release();
    await added;
    await vi.waitFor(() => expect(setData).toHaveBeenCalled());
    expect(log).toEqual(["file", "chunk"]);
    expect(callbacks.onDataLoaded).toHaveBeenCalledTimes(1);
    expect(callbacks.onDataError).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("a GeoParquet file's footer read starts before its chunk arrives (one request for a small file)", async () => {
    const { LayerManager, release, log } = await heldChunk(GP_LIB);
    serving(parquet, log);
    const { map, setData } = mockMap();
    const callbacks = callbacksFor();
    const manager = new LayerManager(map as never, callbacks);
    const added = manager.addLayer({ id: "d", type: "fill", source: { type: "geojson", url: PARQUET } } as never);
    await flush();
    expect(log).toEqual([`file bytes=-${512 * 1024}`]);
    release();
    await added;
    await vi.waitFor(() => expect(setData).toHaveBeenCalled());
    expect(log).toEqual([`file bytes=-${512 * 1024}`, "chunk"]);
    expect(callbacks.onDataError).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("destroy() while a reader chunk downloads starts no reader, and its first request is cancelled", async () => {
    const { LayerManager, release, log } = await heldChunk(FGB_LIB);
    const signals = serving(fgb, log);
    const { map, setData } = mockMap();
    const callbacks = callbacksFor();
    const manager = new LayerManager(map as never, callbacks);
    const added = manager.addLayer({ id: "d", type: "fill", source: { type: "geojson", url: FGB } } as never);
    await flush();
    manager.destroy();
    release();
    await added;
    await flush();
    // The chunk arrived, but nothing was started from it: no reader, no
    // event, and the file's GET cancelled.
    expect(log).toEqual(["file", "chunk"]);
    expect(signals.length > 0 && signals.every((s) => s.aborted)).toBe(true);
    expect(setData).not.toHaveBeenCalled();
    expect(callbacks.onDataLoaded).not.toHaveBeenCalled();
    expect(callbacks.onDataError).not.toHaveBeenCalled();
  });

  it("a source removed while its chunk downloads starts no reader either", async () => {
    const { LayerManager, release, log } = await heldChunk(GP_LIB);
    const signals = serving(parquet, log);
    const { map, setData } = mockMap();
    const callbacks = callbacksFor();
    const manager = new LayerManager(map as never, callbacks);
    manager.registerSources({ p: { type: "geojson", url: PARQUET } } as never);
    await manager.addLayer({ id: "d", type: "fill", source: "p" } as never);
    manager.removeLayer("d");
    manager.removeSource("p");
    release();
    // The chunk is in, its reader not started: the footer read is cancelled.
    await vi.waitFor(() => expect(signals.length > 0 && signals.every((s) => s.aborted)).toBe(true));
    await flush();
    expect(log).toEqual([`file bytes=-${512 * 1024}`, "chunk"]);
    expect(setData).not.toHaveBeenCalled();
    expect(callbacks.onDataError).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("a chunk that fails to download is the source's reader notice; the next load asks for it again and draws", async () => {
    const { LayerManager, fail, log } = await heldChunk(FGB_LIB);
    serving(fgb, log);
    const { map, setData } = mockMap();
    const callbacks = callbacksFor();
    const manager = new LayerManager(map as never, callbacks);
    const added = manager.addLayer({ id: "d", type: "fill", source: { type: "geojson", url: FGB } } as never);
    fail();
    await added;
    await vi.waitFor(() => expect(callbacks.onDataError).toHaveBeenCalledTimes(1));
    const error = callbacks.onDataError.mock.calls[0]![1] as Error & { failure?: unknown };
    expect(error.failure).toMatchObject({ code: "chunk", format: "flatgeobuf" });
    expect(error.message).toContain("The FlatGeobuf reader (");
    expect(error.message).toContain("couldn't be downloaded");
    expect(setData).not.toHaveBeenCalled();
    manager.destroy();

    // Back online: a new load (what `reload()` builds) asks for the file
    // again, under a URL of its own (the browser keeps a failed import).
    const { reimport } = await import("../../src/formats/decoders");
    const retried = vi.spyOn(reimport, "load").mockImplementation(() => import(FGB_LIB));
    vi.doUnmock(FGB_LIB);
    const again = mockMap();
    const next = callbacksFor();
    const fresh = new LayerManager(again.map as never, next);
    await fresh.addLayer({ id: "d", type: "fill", source: { type: "geojson", url: FGB } } as never);
    await vi.waitFor(() => expect(again.setData).toHaveBeenCalled());
    expect(retried).toHaveBeenCalledWith("https://h.org/js/chunks/flatgeobuf.js?retry=1");
    expect(next.onDataError).not.toHaveBeenCalled();
    fresh.destroy();
  });

  it("pause() while the chunk downloads: the by-view reader starts suspended, and resume() starts it", async () => {
    const { LayerManager, release, log } = await heldChunk(FGB_LIB);
    serving(fgb, log);
    const { map } = mockMap();
    const manager = new LayerManager(map as never, callbacksFor());
    const added = manager.addLayer({ id: "d", type: "fill", source: { type: "geojson", url: FGB, load: "viewport" } } as never);
    await flush();
    // Read by view: no whole-file GET to start ahead.
    expect(log).toEqual([]);
    manager.pause();
    release();
    await added;
    await flush();
    expect((manager as any).formatLoaders.get("d-source")?.suspended).toBe(true);
    expect(map.on).not.toHaveBeenCalledWith("moveend", expect.any(Function));
    manager.resume();
    await vi.waitFor(() => expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function)));
    manager.destroy();
  });
});
