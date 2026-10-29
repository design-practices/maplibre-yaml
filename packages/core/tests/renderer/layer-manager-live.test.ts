/**
 * @file Live data as an on-demand chunk (bundle headroom U4, KTD6-KTD8)
 *
 * @description
 * Polling, streaming and merging are the seam's `live` chunk: `LayerManager`
 * fetches it ahead only for a source that will start a pipeline, awaits it
 * after the layer is added (so the first data paints as before), keeps what
 * happened during the wait (a destroy, a pause, a removal), and on a failed
 * download keeps the first data, says once that updates stopped, and lets
 * `reload()` (the re-target path) try again. The seam is stubbed so the test
 * decides when — and whether — the chunk arrives.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const seam = vi.hoisted(() => ({
  /** Every `getDecoder` / `prefetchDecoder` name asked for. */
  loads: [] as string[],
  prefetches: [] as string[],
  /** When set, `getDecoder("live")` answers with this instead of the module. */
  gate: null as null | { promise: Promise<unknown>; resolve: () => void; reject: (error: unknown) => void },
}));

vi.mock("../../src/formats/decoders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/formats/decoders")>();
  return {
    ...actual,
    getDecoder: vi.fn((name: string) => {
      seam.loads.push(name);
      if (name === "live" && seam.gate) return seam.gate.promise;
      return actual.getDecoder(name as never);
    }),
    prefetchDecoder: vi.fn((name: string) => {
      seam.prefetches.push(name);
    }),
  };
});

import { LayerManager } from "../../src/renderer/layer-manager";
import { getDecoder, prefetchDecoder } from "../../src/formats/decoders";
import { FormatError } from "../../src/formats/errors";
import { describeDataProblem } from "../../src/components/student-messages";
import { PollingManager } from "../../src/data/polling-manager";
import { StreamManager } from "../../src/data/streaming/stream-manager";

/** Hold `getDecoder("live")` until `resolve()` (the real module) or `reject(error)`. */
function holdLiveChunk() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = () => res(import("../../src/data/live/index"));
    reject = rej;
  });
  seam.gate = { promise, resolve, reject };
  return seam.gate;
}

/** What the seam rejects with when `chunks/live.js` can't be downloaded. */
const chunkFailure = () =>
  new FormatError({ code: "chunk", format: "live" as never, url: "https://example.com/dist/chunks/live.js", detail: "Failed to fetch" });

const fc = (n: number) => ({
  type: "FeatureCollection" as const,
  features: Array.from({ length: n }, (_, i) => ({
    type: "Feature" as const,
    properties: { id: i },
    geometry: { type: "Point" as const, coordinates: [i, i] },
  })),
});

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  headers: { get: () => null },
  json: async () => body,
});

const REFRESH = { refreshInterval: 60_000, updateStrategy: "replace" as const };

/** A circle layer over an inline source. */
const layer = (source: Record<string, unknown>, id = "quakes") =>
  ({ id, type: "circle", visible: true, toggleable: false, source }) as any;

/** Let pending promise continuations run. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

const live = (m: LayerManager) => (m as any).live as null | { polling: PollingManager; streams: StreamManager };

describe("LayerManager: live data as the `live` chunk (bundle headroom U4)", () => {
  let mockMap: any;
  let callbacks: any;
  let manager: LayerManager;

  beforeEach(() => {
    seam.loads.length = 0;
    seam.prefetches.length = 0;
    seam.gate = null;
    const sources = new Map<string, any>();
    mockMap = {
      addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn(), setUrl: undefined })),
      getSource: vi.fn((id: string) => sources.get(id)),
      removeSource: vi.fn((id: string) => sources.delete(id)),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      removeLayer: vi.fn(),
      setLayoutProperty: vi.fn(),
    };
    callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn() };
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(fc(3))));
    manager = new LayerManager(mockMap, callbacks);
  });

  afterEach(() => {
    manager.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("AE2: a refreshInterval source paints its first data, then polls once the chunk arrives", async () => {
    const chunk = holdLiveChunk();
    const adding = manager.addLayer(layer({ type: "geojson", url: "https://example.com/q.geojson", refresh: REFRESH }));
    // Fetched ahead, alongside the first load.
    expect(seam.prefetches).toEqual(["live"]);
    await flush();
    // The first data is on the map while the chunk is still on its way.
    expect(callbacks.onDataLoaded).toHaveBeenCalledWith("quakes", 3);
    expect(mockMap.addLayer).toHaveBeenCalledTimes(1);
    expect(live(manager)).toBeNull();

    chunk.resolve();
    await adding;
    expect(live(manager)!.polling.has("quakes")).toBe(true);
    expect(callbacks.onDataError).not.toHaveBeenCalled();
  });

  it("a named source with refresh fetches the chunk ahead and polls once per source", async () => {
    manager.registerSources({
      shared: { type: "geojson", url: "https://example.com/s.geojson", refresh: REFRESH },
    });
    expect(seam.prefetches).toEqual(["live"]);
    await manager.addLayer(layer("shared" as any, "a"));
    await manager.addLayer(layer("shared" as any, "b"));
    expect(live(manager)!.polling.getActiveIds()).toEqual(["shared"]);
    expect(manager.isRefreshing("shared")).toBe(true);
  });

  it("a static document never asks for the chunk", async () => {
    manager.registerSources({
      named: { type: "geojson", url: "https://example.com/n.geojson" },
      inlineNamed: { type: "geojson", data: fc(1) },
    });
    await manager.addLayer(layer({ type: "geojson", url: "https://example.com/q.geojson" }));
    await manager.addLayer(layer({ type: "geojson", data: fc(2) }, "inline"));
    await manager.addLayer(layer("named" as any, "over-named"));
    expect(seam.prefetches).toEqual([]);
    expect(seam.loads).not.toContain("live");
    expect(live(manager)).toBeNull();
  });

  it("a legacy updateStrategy alone, or a refresh block with no interval, never asks for the chunk", async () => {
    manager.registerSources({
      legacy: { type: "geojson", url: "https://example.com/l.geojson", updateStrategy: "merge", updateKey: "id" },
      noInterval: { type: "geojson", url: "https://example.com/n.geojson", refresh: { updateStrategy: "merge", updateKey: "id" } },
    });
    await manager.addLayer(layer({ type: "geojson", url: "https://example.com/a.geojson", updateStrategy: "merge", updateKey: "id" }, "a"));
    await manager.addLayer(layer({ type: "geojson", url: "https://example.com/b.geojson", refresh: { updateStrategy: "replace" } }, "b"));
    await manager.addLayer(layer("legacy" as any, "c"));
    await manager.addLayer(layer("noInterval" as any, "d"));
    expect(seam.prefetches).toEqual([]);
    expect(seam.loads).not.toContain("live");
    expect(live(manager)).toBeNull();
  });

  it("pause, resume, destroy and the per-layer refresh calls on a static map are no-ops", async () => {
    await manager.addLayer(layer({ type: "geojson", data: fc(2) }));
    expect(() => {
      manager.pause();
      manager.resume();
      manager.pauseRefresh("quakes");
      manager.resumeRefresh("quakes");
      manager.disconnectStream("quakes");
      manager.removeLayer("quakes");
      manager.destroy();
    }).not.toThrow();
    expect(live(manager)).toBeNull();
    expect(seam.loads).not.toContain("live");
  });

  it("destroy() while the chunk downloads: nothing starts when it arrives", async () => {
    const chunk = holdLiveChunk();
    const start = vi.spyOn(PollingManager.prototype, "start");
    const adding = manager.addLayer(layer({ type: "geojson", url: "https://example.com/q.geojson", refresh: REFRESH }));
    await flush();
    manager.destroy();
    chunk.resolve();
    await adding;
    expect(start).not.toHaveBeenCalled();
    expect(live(manager)).toBeNull();
  });

  it("the source removed while the chunk downloads: nothing starts when it arrives", async () => {
    const chunk = holdLiveChunk();
    const start = vi.spyOn(PollingManager.prototype, "start");
    const adding = manager.addLayer(layer({ type: "geojson", url: "https://example.com/q.geojson", refresh: REFRESH }));
    await flush();
    manager.removeLayer("quakes");
    chunk.resolve();
    await adding;
    expect(start).not.toHaveBeenCalled();
  });

  it("a named source's last layer removed while the chunk downloads: no poll starts, and a layer added again polls", async () => {
    const chunk = holdLiveChunk();
    const start = vi.spyOn(PollingManager.prototype, "start");
    manager.registerSources({ shared: { type: "geojson", url: "https://example.com/s.geojson", refresh: REFRESH } });
    const adding = manager.addLayer(layer("shared" as any, "a"));
    await flush();
    // The document keeps the source; nothing draws it any more.
    manager.removeLayer("a");
    chunk.resolve();
    await adding;
    expect(start).not.toHaveBeenCalled();
    expect(manager.isRefreshing("shared")).toBe(false);

    // Drawn again: its pipeline starts once, as on first add.
    await manager.addLayer(layer("shared" as any, "b"));
    expect(start).toHaveBeenCalledTimes(1);
    expect(live(manager)!.polling.getActiveIds()).toEqual(["shared"]);
    expect(manager.isRefreshing("shared")).toBe(true);
  });

  it("pause() while the chunk downloads: polling starts paused, and resume() lets it go", async () => {
    const chunk = holdLiveChunk();
    const adding = manager.addLayer(layer({ type: "geojson", url: "https://example.com/q.geojson", refresh: REFRESH }));
    await flush();
    manager.pause();
    chunk.resolve();
    await adding;
    expect(live(manager)!.polling.getState("quakes")).toMatchObject({ isActive: true, isPaused: true });
    manager.resume();
    expect(live(manager)!.polling.getState("quakes")).toMatchObject({ isActive: true, isPaused: false });
  });

  it("pause() while the chunk downloads: a stream doesn't connect, and resume() connects it", async () => {
    const chunk = holdLiveChunk();
    const connect = vi.spyOn(StreamManager.prototype, "connect").mockResolvedValue(undefined);
    const adding = manager.addLayer(
      layer({
        type: "geojson",
        url: "https://example.com/q.geojson",
        refresh: { updateStrategy: "replace" },
        stream: { type: "sse", url: "https://example.com/feed" },
      })
    );
    await flush();
    manager.pause();
    chunk.resolve();
    await adding;
    await flush();
    // A paused map (a fallback rebuild) opens no new connection.
    expect(connect).not.toHaveBeenCalled();
    manager.resume();
    await flush();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("quakes", expect.objectContaining({ type: "sse", url: "https://example.com/feed" }));
    // Once: a second resume() connects nothing more.
    manager.pause();
    manager.resume();
    await flush();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("a refresh edit while the chunk downloads on a source that streams and polls: both start, the stream once", async () => {
    const chunk = holdLiveChunk();
    const connect = vi.spyOn(StreamManager.prototype, "connect").mockResolvedValue(undefined);
    const spec = {
      type: "geojson",
      url: "https://example.com/q.geojson",
      refresh: REFRESH,
      stream: { type: "sse", url: "https://example.com/feed" },
    };
    const adding = manager.addLayer(layer(spec));
    await flush();
    // Only a non-stream key changes: the stream's shape is the same.
    const edited = manager.retargetPipeline("quakes-source", { ...spec, refresh: { ...REFRESH, refreshInterval: 30_000 } });
    chunk.resolve();
    await adding;
    await edited;
    await flush();
    expect(live(manager)!.polling.has("quakes")).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("quakes", expect.objectContaining({ type: "sse", url: "https://example.com/feed" }));
  });

  it("a document update that adds refresh to a static source starts polling; one that removes it stops", async () => {
    const plain = { type: "geojson", url: "https://example.com/q.geojson" };
    await manager.addLayer(layer(plain));
    expect(seam.loads).not.toContain("live");

    await manager.retargetPipeline("quakes-source", { ...plain, refresh: REFRESH });
    expect(seam.loads).toContain("live");
    expect(live(manager)!.polling.has("quakes")).toBe(true);

    await manager.retargetPipeline("quakes-source", plain);
    expect(live(manager)!.polling.has("quakes")).toBe(false);
  });

  it("a document update that adds refresh fetches the chunk ahead, as a new source does, before the poll asks for it", async () => {
    const plain = { type: "geojson", url: "https://example.com/q.geojson" };
    await manager.addLayer(layer(plain));
    expect(seam.prefetches).toEqual([]);
    const chunk = holdLiveChunk();
    const start = vi.spyOn(PollingManager.prototype, "start");
    vi.mocked(prefetchDecoder).mockClear();
    vi.mocked(getDecoder).mockClear();
    const edited = manager.retargetPipeline("quakes-source", { ...plain, refresh: REFRESH });
    expect(seam.prefetches).toEqual(["live"]);
    expect(start).not.toHaveBeenCalled();
    // Asked ahead of the poll's own wait for it.
    const prefetchedAt = vi.mocked(prefetchDecoder).mock.invocationCallOrder[0]!;
    const awaitedAt = vi.mocked(getDecoder).mock.invocationCallOrder.at(-1)!;
    expect(prefetchedAt).toBeLessThan(awaitedAt);
    chunk.resolve();
    await edited;
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a blocked chunk: the first data stays, one notice says updates stopped, and reload() retries and polls", async () => {
    const chunk = holdLiveChunk();
    const spec = {
      type: "geojson",
      url: "https://example.com/q.geojson",
      refresh: REFRESH,
      stream: { type: "sse", url: "https://example.com/feed" },
    };
    const connect = vi.spyOn(StreamManager.prototype, "connect").mockResolvedValue(undefined);
    const adding = manager.addLayer(layer(spec));
    await flush();
    chunk.reject(chunkFailure());
    await adding;

    // The first data is on the map; the layer is not failed, its updates are.
    expect(callbacks.onDataLoaded).toHaveBeenCalledWith("quakes", 3);
    expect(mockMap.getSource("quakes-source").setData).toHaveBeenCalledTimes(1);
    // One notice, though the source both streams and polls.
    expect(callbacks.onDataError).toHaveBeenCalledTimes(1);
    const [layerId, error] = callbacks.onDataError.mock.calls[0];
    expect(layerId).toBe("quakes");
    expect(error.message).toMatch(/live-update code .*chunks\/live\.js.* couldn't be downloaded/);
    const notice = describeDataProblem(layerId, error, { filePage: false });
    expect(notice).toMatch(/^`quakes` shows the data it loaded first, but its live updates stopped/);
    expect(notice).toContain("copy the whole `dist/` folder");
    expect(notice).not.toMatch(/has no data|reader/);
    expect(live(manager)).toBeNull();
    // `reload()` retries it: the renderer builds its hints from these.
    expect(manager.failedSources().has("quakes-source")).toBe(true);

    // reload(): the update engine re-targets each failed source in place.
    seam.gate = null;
    await manager.setSourceUrl("quakes-source", spec);
    expect(seam.loads.filter((n) => n === "live")).toHaveLength(2);
    expect(live(manager)!.polling.has("quakes")).toBe(true);
    expect(connect).toHaveBeenCalledWith("quakes", expect.objectContaining({ type: "sse", url: "https://example.com/feed" }));
    expect(manager.failedSources().has("quakes-source")).toBe(false);
    expect(callbacks.onDataError).toHaveBeenCalledTimes(1);
  });

  it("a blocked chunk on a named source whose first load is still on its way: the notice comes after the data", async () => {
    // The first data landing takes that layer's earlier lines off the notice,
    // so the line that updates stopped must come after it.
    let answer!: () => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => (answer = () => resolve(okResponse(fc(2)))))));
    const chunk = holdLiveChunk();
    const order: string[] = [];
    callbacks.onDataLoaded.mockImplementation((id: string) => order.push(`loaded:${id}`));
    callbacks.onDataError.mockImplementation((id: string) => order.push(`error:${id}`));
    manager.registerSources({ shared: { type: "geojson", url: "https://example.com/s.geojson", refresh: REFRESH } });
    const adding = manager.addLayer(layer("shared" as any, "a"));
    chunk.reject(chunkFailure());
    await flush();
    expect(order).toEqual([]);
    answer();
    await adding;
    await flush();
    // The line names the layer drawing the source: what a retried poll's data events name.
    expect(order).toEqual(["loaded:shared", "error:a"]);
    expect(manager.isRefreshing("shared")).toBe(false);
    expect(manager.failedSources().has("shared")).toBe(true);
  });

  it("a live chunk from another maplibre-yaml version: the first data stays and the updates-stopped notice says so", async () => {
    // Chunk names carry no version: a cached or stale `chunks/live.js` whose
    // exports this bundle doesn't know is the chunk notice, not a TypeError.
    const stale = Promise.resolve({ mergeKeyOf: () => undefined });
    seam.gate = { promise: stale, resolve: () => {}, reject: () => {} };
    await manager.addLayer(layer({ type: "geojson", url: "https://example.com/q.geojson", refresh: REFRESH }));
    await flush();
    expect(callbacks.onDataLoaded).toHaveBeenCalledWith("quakes", 3);
    expect(callbacks.onDataError).toHaveBeenCalledTimes(1);
    const [layerId, error] = callbacks.onDataError.mock.calls[0];
    expect(error.failure).toMatchObject({ code: "chunk", format: "live", url: "chunks/live.js" });
    expect(error.failure.detail).toMatch(/another maplibre-yaml version/);
    expect(describeDataProblem(layerId, error, { filePage: false })).toMatch(/^`quakes` shows the data it loaded first, but its live updates stopped/);
    expect(live(manager)).toBeNull();
    expect(manager.failedSources().has("quakes-source")).toBe(true);
  });

  it("merge onto inline `data:`: the starting features stay and stream messages merge into them (ml-7qa.12)", async () => {
    let onData!: (data: unknown) => void;
    vi.spyOn(StreamManager.prototype, "connect").mockImplementation(async (_id, config) => {
      onData = config.onData as never;
    });
    const seed = fc(2);
    await manager.addLayer(
      layer({
        type: "geojson",
        data: seed,
        stream: { type: "sse", url: "https://example.com/feed" },
        refresh: { updateStrategy: "merge", updateKey: "id" },
      })
    );
    await flush();
    const setData = mockMap.getSource("quakes-source").setData;
    // Feature 1 moves; feature 7 is new; feature 0 is only in the starting data.
    onData({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { id: 1, moved: true }, geometry: { type: "Point", coordinates: [9, 9] } },
        { type: "Feature", properties: { id: 7 }, geometry: { type: "Point", coordinates: [7, 7] } },
      ],
    });
    const merged = setData.mock.calls.at(-1)[0];
    expect(merged.features.map((f: any) => f.properties.id).sort()).toEqual([0, 1, 7]);
    expect(merged.features.find((f: any) => f.properties.id === 1).properties.moved).toBe(true);
    expect(callbacks.onDataLoaded).toHaveBeenLastCalledWith("quakes", 3);
    // The document's own `data:` object is untouched.
    expect(seed.features).toHaveLength(2);
  });

  it("a stream whose first connection fails keeps the layer and its data, with one notice (ml-7qa.12)", async () => {
    vi.useFakeTimers();
    try {
      const made: any[] = [];
      vi.stubGlobal(
        "EventSource",
        class {
          readyState = 0;
          private listeners = new Map<string, Set<() => void>>();
          constructor() {
            made.push(this);
            // The feed answers 404: the browser gives up (CLOSED).
            setTimeout(() => {
              this.readyState = 2;
              for (const fn of this.listeners.get("error") ?? []) fn();
            }, 0);
          }
          addEventListener(type: string, fn: () => void) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type)!.add(fn);
          }
          removeEventListener(type: string, fn: () => void) {
            this.listeners.get(type)?.delete(fn);
          }
          close() {
            this.readyState = 2;
          }
        }
      );
      const adding = manager.addLayer(
        layer({
          type: "geojson",
          data: fc(2),
          stream: { type: "sse", url: "https://example.com/missing", reconnectMaxAttempts: 2, reconnectDelay: 100 },
          refresh: { updateStrategy: "merge", updateKey: "id" },
        })
      );
      await vi.advanceTimersByTimeAsync(0);
      await expect(adding).resolves.toBeUndefined();
      expect(mockMap.addLayer).toHaveBeenCalledTimes(1);
      expect(mockMap.removeLayer).not.toHaveBeenCalled();
      expect(callbacks.onDataError).toHaveBeenCalledTimes(1);
      const [layerId, error] = callbacks.onDataError.mock.calls[0];
      expect(layerId).toBe("quakes");
      expect(describeDataProblem(layerId, error, { filePage: false })).toBe(
        "`quakes` shows the data it has, but isn't getting live updates: the stream `https://example.com/missing` couldn't connect."
      );
      // Retried per the reconnect options (two attempts), silently.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(made).toHaveLength(3);
      expect(callbacks.onDataError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshNow on a layer with no poll still rejects as it did", async () => {
    await manager.addLayer(layer({ type: "geojson", data: fc(1) }));
    await expect(manager.refreshNow("quakes")).rejects.toThrow('Polling subscription "quakes" not found');
  });
});
