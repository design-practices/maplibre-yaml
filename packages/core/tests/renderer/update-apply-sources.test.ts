/**
 * @file Applying source operations on a live map (live documents, U3)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * `applyOps` changes a source in place when MapLibre has a setter for it
 * (`setData`, `setTiles`, `setUrl`), re-targets live-data pipelines only
 * when their configuration changed, recreates by-view loaders whose options
 * changed, drops stale results through a generation check, and falls back
 * to a replacement of the source and its layers when a setter is absent
 * (KTD4, KTD5). Each test maps to one bullet of the plan's U3 test scenarios
 * (docs/plans/2026-10-27-001-feat-live-documents-plan.md).
 *
 * The map is the same style-backed double `update-apply-layers.test.ts`
 * uses, extended with a source table whose tile sources carry `setTiles` /
 * `setUrl` unless a test asks for a map without them (an older peer major).
 * The fetcher is a hand-driven double so a test decides which response
 * lands when: the stale-response race is the behaviour most likely to
 * regress silently, so it is written first.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureCollection } from "geojson";

const popupInstance = {
  setLngLat: vi.fn().mockReturnThis(),
  setHTML: vi.fn().mockReturnThis(),
  setDOMContent: vi.fn().mockReturnThis(),
  on: vi.fn(),
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

vi.mock("maplibre-gl", () => {
  const Popup = vi.fn(() => popupInstance);
  return { default: { Popup }, Popup };
});

import { applyOps } from "../../src/renderer/update/apply";
import { diff } from "../../src/renderer/update/diff";
import type { AppliedDocument, DiffHints, UpdateHost } from "../../src/renderer/update/types";
import { LayerManager } from "../../src/renderer/layer-manager";
import { EventHandler } from "../../src/renderer/event-handler";
import { PollingManager } from "../../src/data/polling-manager";
import { StreamManager } from "../../src/data/streaming/stream-manager";
import { FlatGeobufLoader } from "../../src/renderer/cloud-sources";
import type { Layer } from "../../src/schemas/layer.schema";
import type { LayerSource } from "../../src/schemas/source.schema";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const NO_HINTS: DiffHints = { failedSources: new Set(), urlsRebased: false };

/** A one-point collection whose feature is named, so assertions read which response landed. */
function fc(...names: string[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: names.map((name, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [i, 0] },
      properties: { name },
    })),
  };
}

type StyleLayer = { id: string; type: string; source?: string; paint: Record<string, unknown>; layout: Record<string, unknown> };

/**
 * A map double whose style keeps a real layer order and source table. Tile
 * sources get `setTiles` / `setUrl` (maplibre-gl 4+) unless `tileSetters`
 * is false (a raster source on maplibre-gl 3.0, say).
 */
function createMockMap(basemap: string[] = ["land"], { tileSetters = true } = {}) {
  const layers: StyleLayer[] = basemap.map((id) => ({ id, type: "fill", source: "basemap", paint: {}, layout: {} }));
  const sources: Record<string, any> = { basemap: { type: "vector" } };
  const find = (id: string) => layers.findIndex((l) => l.id === id);
  const mustFind = (id: string) => {
    const index = find(id);
    if (index < 0) throw new Error(`The layer '${id}' does not exist in the map's style.`);
    return index;
  };
  const map = {
    order: () => layers.map((l) => l.id),
    source: (id: string) => sources[id],
    getStyle: vi.fn(() => ({ layers: layers.map((l) => ({ ...l })), sources: { ...sources } })),
    getLayer: vi.fn((id: string) => layers[find(id)]),
    addLayer: vi.fn((spec: any, before?: string) => {
      if (find(spec.id) >= 0) throw new Error(`Layer "${spec.id}" already exists on this map.`);
      if (spec.source && !sources[spec.source]) throw new Error(`Source "${spec.source}" not found.`);
      const entry: StyleLayer = { paint: {}, layout: {}, ...spec };
      if (before === undefined) layers.push(entry);
      else {
        const index = find(before);
        if (index < 0) throw new Error(`Layer with id "${before}" does not exist on this map.`);
        layers.splice(index, 0, entry);
      }
    }),
    removeLayer: vi.fn((id: string) => {
      layers.splice(mustFind(id), 1);
    }),
    moveLayer: vi.fn((id: string, before?: string) => {
      const [entry] = layers.splice(mustFind(id), 1);
      if (before === undefined) layers.push(entry!);
      else layers.splice(mustFind(before), 0, entry!);
    }),
    addSource: vi.fn((id: string, spec: any) => {
      if (sources[id]) throw new Error("There is already a source with this ID");
      const instance: Record<string, unknown> = { ...spec, setData: vi.fn() };
      if (tileSetters && (spec.type === "vector" || spec.type === "raster" || spec.type === "raster-dem")) {
        instance.setTiles = vi.fn();
        instance.setUrl = vi.fn();
      }
      sources[id] = instance;
    }),
    removeSource: vi.fn((id: string) => {
      if (layers.some((l) => l.source === id)) throw new Error(`Source "${id}" cannot be removed while layer "${layers.find((l) => l.source === id)!.id}" is using it.`);
      delete sources[id];
    }),
    getSource: vi.fn((id: string) => sources[id]),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    setFilter: vi.fn(),
    setLayerZoomRange: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 10),
    getBounds: vi.fn(() => ({ getWest: () => 0, getSouth: () => 0, getEast: () => 1, getNorth: () => 1 })),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
  };
  return map;
}

type MockMap = ReturnType<typeof createMockMap>;

/** A hand-driven `DataFetcher`: each request resolves only when the test says so. */
function createFetcher() {
  const pending = new Map<string, { resolve: (data: FeatureCollection) => void; reject: (error: Error) => void }[]>();
  const fetch = vi.fn((url: string) => {
    return new Promise<{ data: FeatureCollection; fromCache: boolean; featureCount: number; duration: number }>((resolve, reject) => {
      const queue = pending.get(url) ?? [];
      queue.push({
        resolve: (data) => resolve({ data, fromCache: false, featureCount: data.features.length, duration: 0 }),
        reject,
      });
      pending.set(url, queue);
    });
  });
  const next = (url: string) => {
    const entry = pending.get(url)?.shift();
    if (!entry) throw new Error(`No request in flight for ${url}`);
    return entry;
  };
  return {
    fetch,
    requests: (url: string) => fetch.mock.calls.filter(([u]) => u === url).length,
    /** Resolve the oldest in-flight request for `url` and let its continuation run. */
    respond: async (url: string, data: FeatureCollection) => {
      next(url).resolve(data);
      await flush();
    },
    fail: async (url: string, message = "503 Service Unavailable") => {
      next(url).reject(new Error(message));
      await flush();
    },
  };
}

/** Let every settled promise continuation run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
}

/** The host `MapRenderer.update` will build (U4), over real collaborators. */
function createHost(map: MockMap) {
  const onError = vi.fn();
  const fetcher = createFetcher();
  const callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn(), onSourceHint: vi.fn() };
  const layerManager = new LayerManager(map as any, callbacks, { fetcher: fetcher as never });
  const eventHandler = new EventHandler(map as any, {});
  const emit = vi.fn();
  const host: UpdateHost = {
    map: map as any,
    layerManager,
    eventHandler,
    controlsManager: {} as any,
    onError: (error, context) => onError(error, false, context),
    reattachEffects: vi.fn(),
    prepareLayer: (layer) => layer,
    emit,
  };
  return { host, map, layerManager, eventHandler, onError, emit, fetcher, callbacks };
}

type Host = ReturnType<typeof createHost>;

function layer(id: string, overrides: Record<string, unknown> = {}): Layer {
  return {
    id,
    type: "circle",
    visible: true,
    toggleable: false,
    source: { type: "geojson", data: EMPTY },
    paint: { "circle-color": "#f00" },
    ...overrides,
  } as unknown as Layer;
}

function doc(layers: Layer[], sources: Record<string, LayerSource> = {}): AppliedDocument {
  return {
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" } as AppliedDocument["config"],
    layers,
    sources,
    options: {},
  };
}

const geojson = (extra: Record<string, unknown>): LayerSource => ({ type: "geojson", ...extra }) as unknown as LayerSource;
const vector = (extra: Record<string, unknown>): LayerSource => ({ type: "vector", ...extra }) as unknown as LayerSource;

/** First render, as `MapRenderer` does it: named sources, then each layer and its events. */
async function render(h: Host, document: AppliedDocument): Promise<void> {
  h.layerManager.registerSources(document.sources);
  for (const entry of document.layers) {
    await h.layerManager.addLayer(entry);
    h.eventHandler.attachEvents(entry);
  }
  await flush();
}

/** Diff and apply, the way `update()` will chain them. */
async function update(h: Host, applied: AppliedDocument, next: AppliedDocument, hints = NO_HINTS) {
  const { ops, summary } = diff(applied, next, hints);
  const result = await applyOps(h.host, { applied, next, ops, summary });
  await flush();
  return result;
}

const setDataCalls = (h: Host, sourceId: string): FeatureCollection[] =>
  (h.map.source(sourceId).setData as ReturnType<typeof vi.fn>).mock.calls.map(([data]: [FeatureCollection]) => data);
const lastSetData = (h: Host, sourceId: string) => setDataCalls(h, sourceId).at(-1);
const names = (data: FeatureCollection | undefined) => data?.features.map((f) => f.properties?.["name"]);

const A = "https://h.org/a.geojson";
const B = "https://h.org/b.geojson";
const C = "https://h.org/c.geojson";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyOps: GeoJSON url changes (KTD4, KTD5)", () => {
  it("two updates in quick succession where the first fetch resolves last: the map holds the second document's data", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("quakes", { source: "quakes" })], { quakes: geojson({ url: A }) });
    await render(h, applied);
    await h.fetcher.respond(A, fc("a"));
    expect(names(lastSetData(h, "quakes"))).toEqual(["a"]);

    const second = doc([layer("quakes", { source: "quakes" })], { quakes: geojson({ url: B }) });
    const third = doc([layer("quakes", { source: "quakes" })], { quakes: geojson({ url: C }) });
    await update(h, applied, second);
    await update(h, second, third);
    expect(h.fetcher.requests(B)).toBe(1);
    expect(h.fetcher.requests(C)).toBe(1);

    // C answers first, then the stale B.
    await h.fetcher.respond(C, fc("c"));
    await h.fetcher.respond(B, fc("b"));

    expect(names(lastSetData(h, "quakes"))).toEqual(["c"]);
    expect(setDataCalls(h, "quakes").map(names)).not.toContainEqual(["b"]);
    expect(names(h.layerManager.getSourceData("quakes"))).toEqual(["c"]);
    // The stale response is dropped silently: no load event for it either.
    expect(h.callbacks.onDataLoaded.mock.calls.filter(([, count]) => count === 1)).toHaveLength(2); // a, then c
    h.layerManager.destroy();
  });

  it("a url change on a named GeoJSON source calls setData with the new fetch result and leaves dependent layers in place (AE2)", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("quakes", { source: "quakes" }), layer("labels", { type: "symbol", source: "quakes" })], {
      quakes: geojson({ url: A }),
    });
    await render(h, applied);
    await h.fetcher.respond(A, fc("a"));
    h.map.removeLayer.mockClear();
    h.map.addLayer.mockClear();

    const next = doc(applied.layers, { quakes: geojson({ url: B }) });
    const summary = await update(h, applied, next);
    await h.fetcher.respond(B, fc("b1", "b2"));

    expect(names(lastSetData(h, "quakes"))).toEqual(["b1", "b2"]);
    expect(h.map.removeLayer).not.toHaveBeenCalled();
    expect(h.map.addLayer).not.toHaveBeenCalled();
    expect(h.map.removeSource).not.toHaveBeenCalled();
    expect(h.map.order()).toEqual(["land", "quakes", "labels"]);
    expect(summary.failures).toEqual([]);
    // Dependent layers hear about the new data, as they do on first load and refresh.
    const loaded = h.callbacks.onDataLoaded.mock.calls.filter(([, count]) => count === 2).map(([id]) => id);
    expect(loaded.sort()).toEqual(["labels", "quakes"]);
    h.layerManager.destroy();
  });

  it("an inline url change reaches the fetch path too, without replacing the layer", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("quakes", { source: { type: "geojson", url: A } })]);
    // An inline url: layer's add awaits its first fetch, as on first render.
    const rendering = render(h, applied);
    await flush();
    await h.fetcher.respond(A, fc("a"));
    await rendering;
    h.map.removeLayer.mockClear();

    await update(h, applied, doc([layer("quakes", { source: { type: "geojson", url: B } })]));
    await h.fetcher.respond(B, fc("b"));

    expect(names(lastSetData(h, "quakes-source"))).toEqual(["b"]);
    expect(h.map.removeLayer).not.toHaveBeenCalled();
    h.layerManager.destroy();
  });
});

describe("applyOps: inline data changes", () => {
  it("an inline data change calls setData and resetFeatureState on the dependent layer", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("pins", { source: { type: "geojson", data: fc("old") } })]);
    await render(h, applied);
    const reset = vi.spyOn(h.eventHandler, "resetFeatureState");
    h.map.removeLayer.mockClear();

    const summary = await update(h, applied, doc([layer("pins", { source: { type: "geojson", data: fc("new") } })]));

    expect(names(lastSetData(h, "pins-source"))).toEqual(["new"]);
    expect(reset).toHaveBeenCalledWith("pins");
    expect(h.map.removeLayer).not.toHaveBeenCalled();
    expect(summary.failures).toEqual([]);
    h.layerManager.destroy();
  });

  it("a named inline-data change resets feature state on every layer that draws the source", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("a", { source: "pts" }), layer("b", { source: "pts" })], { pts: geojson({ data: fc("old") }) });
    await render(h, applied);
    const reset = vi.spyOn(h.eventHandler, "resetFeatureState");

    await update(h, applied, doc(applied.layers, { pts: geojson({ data: fc("new") }) }));

    expect(names(lastSetData(h, "pts"))).toEqual(["new"]);
    expect(reset.mock.calls.map(([id]) => id).sort()).toEqual(["a", "b"]);
    h.layerManager.destroy();
  });
});

describe("applyOps: tile source changes with and without setters (KTD4)", () => {
  const tilesV1 = ["https://t.org/v1/{z}/{x}/{y}.pbf"];
  const tilesV2 = ["https://t.org/v2/{z}/{x}/{y}.pbf"];

  it("a vector tiles change calls setTiles when the source has it", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("roads", { type: "line", source: "osm", "source-layer": "roads" })], { osm: vector({ tiles: tilesV1 }) });
    await render(h, applied);
    h.map.removeLayer.mockClear();

    const summary = await update(h, applied, doc(applied.layers, { osm: vector({ tiles: tilesV2 }) }));

    expect(h.map.source("osm").setTiles).toHaveBeenCalledWith(tilesV2);
    expect(h.map.removeSource).not.toHaveBeenCalled();
    expect(h.map.removeLayer).not.toHaveBeenCalled();
    expect(summary.failures).toEqual([]);
    h.layerManager.destroy();
  });

  it("a vector url change calls setUrl when the source has it", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("roads", { type: "line", source: "osm", "source-layer": "roads" })], { osm: vector({ url: "https://t.org/v1.json" }) });
    await render(h, applied);

    await update(h, applied, doc(applied.layers, { osm: vector({ url: "https://t.org/v2.json" }) }));

    expect(h.map.source("osm").setUrl).toHaveBeenCalledWith("https://t.org/v2.json");
    expect(h.map.removeSource).not.toHaveBeenCalled();
    h.layerManager.destroy();
  });

  it("with a source lacking setTiles it replaces the source and its layers in position", async () => {
    const h = createHost(createMockMap(["land", "water"], { tileSetters: false }));
    const roads = layer("roads", { type: "line", source: "osm", "source-layer": "roads", before: "water" });
    const applied = doc([roads, layer("pins")], { osm: vector({ tiles: tilesV1 }) });
    await render(h, applied);
    expect(h.map.order()).toEqual(["land", "roads", "water", "pins"]);
    h.map.addLayer.mockClear();

    const summary = await update(h, applied, doc(applied.layers, { osm: vector({ tiles: tilesV2 }) }));

    expect(h.map.removeSource).toHaveBeenCalledWith("osm");
    expect(h.map.addSource).toHaveBeenLastCalledWith("osm", expect.objectContaining({ type: "vector", tiles: tilesV2 }));
    expect(h.map.source("osm").tiles).toEqual(tilesV2);
    expect(h.map.addLayer).toHaveBeenCalledTimes(1);
    expect(h.map.order()).toEqual(["land", "roads", "water", "pins"]);
    expect(h.map.getLayer("roads")?.source).toBe("osm");
    expect(summary.sourcesReplaced).toEqual(["osm"]);
    expect(summary.replaced).toEqual(["roads"]);
    expect(summary.failures).toEqual([]);
    expect(h.layerManager.sourceRefCount("osm")).toBe(1);
    h.layerManager.destroy();
  });

  it("a constructor-only change on a named source replaces it and its layers in position (the differ's sourceReplace)", async () => {
    const h = createHost(createMockMap(["land", "water"]));
    const applied = doc([layer("pins", { source: "pts", before: "water" })], { pts: geojson({ data: fc("x"), cluster: false }) });
    await render(h, applied);

    const summary = await update(h, applied, doc(applied.layers, { pts: geojson({ data: fc("x"), cluster: true }) }));

    expect(h.map.removeSource).toHaveBeenCalledWith("pts");
    expect(h.map.source("pts").cluster).toBe(true);
    expect(h.map.order()).toEqual(["land", "pins", "water"]);
    expect(summary.sourcesReplaced).toEqual(["pts"]);
    expect(summary.replaced).toEqual(["pins"]);
    expect(summary.failures).toEqual([]);
    h.layerManager.destroy();
  });

  it("a source a host layer still draws is left in place and reported as a failure (KTD4)", async () => {
    const h = createHost(createMockMap(["land"], { tileSetters: false }));
    const applied = doc([layer("roads", { type: "line", source: "osm", "source-layer": "roads" })], { osm: vector({ tiles: tilesV1 }) });
    await render(h, applied);
    h.map.addLayer({ id: "host-roads", type: "line", source: "osm" });

    const summary = await update(h, applied, doc(applied.layers, { osm: vector({ tiles: tilesV2 }) }));

    expect(h.map.removeSource).not.toHaveBeenCalled();
    expect(h.map.order()).toEqual(["land", "roads", "host-roads"]);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]!.message).toMatch(/host-roads/);
    expect(h.onError).toHaveBeenCalledWith(expect.any(Error), false, { kind: "source", sourceId: "osm" });
    h.layerManager.destroy();
  });
});

describe("applyOps: live-data pipelines re-target only when their configuration changed", () => {
  // Real timers: the polls' 30-second timers never fire inside a test and are cleared by `destroy()`.
  const live = (interval: number, extra: Record<string, unknown> = {}) =>
    geojson({ url: A, refresh: { refreshInterval: interval, updateStrategy: "replace", ...extra } });

  it("refresh.refreshInterval 30s to 60s calls setInterval, not stop/start", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("quakes", { source: "quakes" })], { quakes: live(30_000) });
    await render(h, applied);
    const setInterval = vi.spyOn(PollingManager.prototype, "setInterval");
    const stop = vi.spyOn(PollingManager.prototype, "stop");
    const start = vi.spyOn(PollingManager.prototype, "start");
    expect(h.layerManager.isRefreshing("quakes")).toBe(true);

    const summary = await update(h, applied, doc(applied.layers, { quakes: live(60_000) }));

    expect(setInterval).toHaveBeenCalledWith("quakes", 60_000);
    expect(stop).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(h.fetcher.requests(A)).toBe(1); // no refetch for an interval tweak
    expect(summary.failures).toEqual([]);
    h.layerManager.destroy();
  });

  it("removing refresh stops polling; adding it starts polling", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("quakes", { source: "quakes" })], { quakes: live(30_000) });
    await render(h, applied);
    expect(h.layerManager.isRefreshing("quakes")).toBe(true);

    const still = doc(applied.layers, { quakes: geojson({ url: A }) });
    await update(h, applied, still);
    expect(h.layerManager.isRefreshing("quakes")).toBe(false);

    await update(h, still, doc(applied.layers, { quakes: live(45_000) }));
    expect(h.layerManager.isRefreshing("quakes")).toBe(true);
    h.layerManager.destroy();
  });

  it("a stream change disconnects and reconnects", async () => {
    const connect = vi.spyOn(StreamManager.prototype, "connect").mockResolvedValue(undefined);
    const disconnect = vi.spyOn(StreamManager.prototype, "disconnect");
    const h = createHost(createMockMap());
    const stream = (url: string) => geojson({ url: A, refresh: { refreshInterval: 30_000 }, stream: { type: "websocket", url } });
    const applied = doc([layer("quakes", { source: "quakes" })], { quakes: stream("wss://h.org/v1") });
    await render(h, applied);
    expect(connect).toHaveBeenCalledTimes(1);
    disconnect.mockClear();

    await update(h, applied, doc(applied.layers, { quakes: stream("wss://h.org/v2") }));

    expect(disconnect).toHaveBeenCalledWith("quakes");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect.mock.calls[1]![1]).toMatchObject({ url: "wss://h.org/v2" });
    h.layerManager.destroy();
  });

  it("a merge strategy change clears accumulated features and refetches at once", async () => {
    const h = createHost(createMockMap());
    const merging = geojson({ url: A, refresh: { refreshInterval: 30_000, updateStrategy: "merge", updateKey: "name" } });
    const applied = doc([layer("quakes", { source: "quakes" })], { quakes: merging });
    await render(h, applied);
    await h.fetcher.respond(A, fc("a"));
    const tick = h.layerManager.refreshNow("quakes");
    await flush();
    await h.fetcher.respond(A, fc("b"));
    await tick;
    expect(names(h.layerManager.getSourceData("quakes"))?.sort()).toEqual(["a", "b"]);

    await update(h, applied, doc(applied.layers, { quakes: live(30_000) }));

    // The accumulation is gone and the source is fetched again now, not an interval later.
    expect(h.fetcher.requests(A)).toBe(3);
    await h.fetcher.respond(A, fc("c"));
    expect(names(h.layerManager.getSourceData("quakes"))).toEqual(["c"]);
    expect(names(lastSetData(h, "quakes"))).toEqual(["c"]);
    h.layerManager.destroy();
  });
});

describe("applyOps: by-view loaders are recreated when their options change", () => {
  const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/public/gallery-assets/cloud-native");
  const fgb = new Uint8Array(readFileSync(join(FIXTURES, "districts.fgb")));
  const FGB = "https://h.org/districts.fgb";

  /** A fetch that serves the fixture whole, each response released by the test. */
  function stubFetch() {
    const gates: (() => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            gates.push(() => resolve(new Response(fgb, { status: 200, headers: { "content-length": String(fgb.length) } })));
          })
      )
    );
    return { release: async () => { gates.shift()?.(); await flush(); await flush(); }, inFlight: () => gates.length };
  }

  afterEach(() => vi.unstubAllGlobals());
  // `load: viewport` on a host without range requests reads whole, with a console note.
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("a load.maxFeatures change destroys the old loader and starts a new one; the old loader's late read never lands", async () => {
    const gate = stubFetch();
    const destroy = vi.spyOn(FlatGeobufLoader.prototype, "destroy");
    const h = createHost(createMockMap());
    const applied = doc([layer("districts", { type: "fill", source: "d" })], { d: geojson({ url: FGB, load: { maxFeatures: 1000 } }) });
    await render(h, applied);
    expect(gate.inFlight()).toBe(1);

    await update(h, applied, doc(applied.layers, { d: geojson({ url: FGB, load: { maxFeatures: 2000 } }) }));
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(gate.inFlight()).toBe(2);

    // The old read lands after the new loader took over: it is dropped.
    await gate.release();
    await vi.waitFor(() => expect(gate.inFlight()).toBe(1));
    expect(h.map.source("d").setData).not.toHaveBeenCalled();
    await gate.release();
    await vi.waitFor(() => expect(h.map.source("d").setData).toHaveBeenCalledTimes(1));
    expect(h.callbacks.onDataLoaded).toHaveBeenCalledTimes(1);
    h.layerManager.destroy();
  });

  it("a suspended loader stays suspended across the recreate", async () => {
    stubFetch();
    const h = createHost(createMockMap());
    const applied = doc([layer("districts", { type: "fill", source: "d" })], { d: geojson({ url: FGB, load: "viewport" }) });
    await render(h, applied);
    // Nothing draws the source any more: the loader is suspended.
    const bare = doc([], applied.sources);
    await update(h, applied, bare);
    expect(h.layerManager.sourceRefCount("d")).toBe(0);
    const suspend = vi.spyOn(FlatGeobufLoader.prototype, "suspend");

    await update(h, bare, doc([], { d: geojson({ url: FGB, load: { mode: "viewport", maxFeatures: 2000 } }) }));

    // The old reader's destroy suspends it too; the new reader is the last one suspended.
    expect(suspend).toHaveBeenCalled();
    const fresh = suspend.mock.instances.at(-1) as unknown as FlatGeobufLoader;
    expect(fresh).not.toBe(suspend.mock.instances[0]);
    expect(fresh.suspended).toBe(true);
    h.layerManager.destroy();
  });
});

describe("applyOps: failed sources are remembered for hints.failedSources (KTD11)", () => {
  it("a source whose fetch failed is in the failure state; an equal-document update with the hint retries it", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("quakes", { source: "quakes" })], { quakes: geojson({ url: A }) });
    await render(h, applied);
    await h.fetcher.fail(A);
    expect(h.callbacks.onDataError).toHaveBeenCalledTimes(1);
    expect([...h.layerManager.failedSources()]).toEqual(["quakes"]);

    // Equal documents, no hint: nothing happens.
    const quiet = await update(h, applied, applied);
    expect(h.fetcher.requests(A)).toBe(1);
    expect(quiet.failures).toEqual([]);

    // reload(): the renderer passes the failure state as the hint.
    await update(h, applied, applied, { failedSources: h.layerManager.failedSources(), urlsRebased: false });
    expect(h.fetcher.requests(A)).toBe(2);
    await h.fetcher.respond(A, fc("a"));
    expect(names(lastSetData(h, "quakes"))).toEqual(["a"]);
    expect(h.layerManager.failedSources().size).toBe(0);
    h.layerManager.destroy();
  });

  it("a removed source leaves the failure state", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("quakes", { source: "quakes" })], { quakes: geojson({ url: A }) });
    await render(h, applied);
    await h.fetcher.fail(A);
    expect(h.layerManager.failedSources().has("quakes")).toBe(true);

    await update(h, applied, doc([]));

    expect(h.layerManager.failedSources().size).toBe(0);
    h.layerManager.destroy();
  });
});

describe("applyOps: an update completes when its operations are applied, not when a url: has been read (KTD5)", () => {
  it("adding a layer over an inline url: source resolves before the fetch answers, and a second update is not held behind it", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("a")]);
    await render(h, applied);

    // The fetcher never answers for A: the layer is placed with its source all the same.
    const withQuakes = doc([layer("a"), layer("quakes", { source: geojson({ url: A }) })]);
    const first = await update(h, applied, withQuakes);
    expect(first.failures).toEqual([]);
    expect(first.added).toEqual(["quakes"]);
    expect(h.map.order()).toEqual(["land", "a", "quakes"]);
    expect(h.map.getSource("quakes-source")).toBeDefined();
    expect(h.fetcher.requests(A)).toBe(1);
    expect(h.callbacks.onDataLoading).toHaveBeenCalledWith("quakes");
    expect(h.callbacks.onDataLoaded).not.toHaveBeenCalled();

    // A second update applies at once: a paint change lands while A is still in flight.
    const recoloured = doc([layer("a", { paint: { "circle-color": "#00f" } }), layer("quakes", { source: geojson({ url: A }) })]);
    const second = await update(h, withQuakes, recoloured);
    expect(second.failures).toEqual([]);
    expect(h.map.setPaintProperty).toHaveBeenCalledWith("a", "circle-color", "#00f");

    // When A finally answers, the data lands under the generation it started in.
    await h.fetcher.respond(A, fc("q1"));
    expect(names(lastSetData(h, "quakes-source"))).toEqual(["q1"]);
    expect(h.callbacks.onDataLoaded).toHaveBeenCalledWith("quakes", 1);
    h.layerManager.destroy();
  });

  it("a replaced layer over an inline url: source is placed before its fetch answers too, and a stale answer never lands", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("quakes", { source: geojson({ url: A }) })]);
    // First render keeps awaiting the data (its `load` contract): answer A while it waits.
    const rendering = render(h, applied);
    await flush();
    await h.fetcher.respond(A, fc("a"));
    await rendering;

    // A type change replaces the layer; its source is re-added and fetched again (never answered here).
    const asSymbol = doc([layer("quakes", { type: "symbol", source: geojson({ url: A }) })]);
    const summary = await update(h, applied, asSymbol);
    expect(summary.failures).toEqual([]);
    expect(summary.replaced).toEqual(["quakes"]);
    expect(h.map.getLayer("quakes")!.type).toBe("symbol");
    expect(h.fetcher.requests(A)).toBe(2);
    h.layerManager.destroy();
  });
});

describe("applyOps: the generateId rule follows the next document's layers (ml-aot.142)", () => {
  it("a sourceReplace with reason generateId rebuilds the named source with generateId: true once the manager is told which sources need ids", async () => {
    const h = createHost(createMockMap());
    const applied = doc([layer("pins", { source: "pts" })], { pts: geojson({ data: fc("x") }) });
    await render(h, applied);
    expect(h.map.addSource).toHaveBeenCalledWith("pts", expect.not.objectContaining({ generateId: true }));
    h.map.addSource.mockClear();

    const hovered = doc([layer("pins", { source: "pts", interactive: { hover: { highlight: true } } })], applied.sources);
    const { ops } = diff(applied, hovered, NO_HINTS);
    expect(ops).toContainEqual(expect.objectContaining({ op: "sourceReplace", sourceId: "pts", reason: "generateId" }));

    // What `MapRenderer.performUpdate` does before running the engine.
    h.layerManager.setNamedSourcesNeedingIds(new Set(["pts"]));
    const summary = await update(h, applied, hovered);

    expect(summary.failures).toEqual([]);
    expect(summary.sourcesReplaced).toEqual(["pts"]);
    expect(h.map.addSource).toHaveBeenCalledTimes(1);
    expect(h.map.addSource).toHaveBeenCalledWith("pts", expect.objectContaining({ type: "geojson", generateId: true }));
    h.layerManager.destroy();
  });
});
