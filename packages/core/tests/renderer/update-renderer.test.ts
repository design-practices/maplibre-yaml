/**
 * @file `MapRenderer.update()` driving the real runtime features (live documents, U4)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * update-resync.test.ts proves the engine asks the renderer's runtime
 * surface at the right moments; this proves what the renderer does when
 * asked, through the public `update()` over the real managers: markers
 * appear and popups close, a changed `classify.field` reaches the legend
 * (AE11), a projection the runtime lacks warns once and records no failure,
 * the title renames the canvas, and the effects hook fires per update.
 * The map double keeps a real style (layer order, sources) so reconciliation
 * sees the document's layers as present.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const popupInstance = () => ({
  setLngLat: vi.fn().mockReturnThis(),
  setHTML: vi.fn().mockReturnThis(),
  setDOMContent: vi.fn().mockReturnThis(),
  setMaxWidth: vi.fn().mockReturnThis(),
  on: vi.fn(),
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(),
});
const popups: ReturnType<typeof popupInstance>[] = [];
const markers: Array<{ remove: ReturnType<typeof vi.fn> }> = [];

vi.mock("maplibre-gl", () => {
  type StyleLayer = { id: string; type: string; source?: string; paint: Record<string, unknown>; layout: Record<string, unknown> };
  class MockMap {
    private events = new Map<string, Set<Function>>();
    private layers: StyleLayer[] = [{ id: "land", type: "fill", source: "basemap", paint: {}, layout: {} }];
    private sources: Record<string, any> = { basemap: { type: "vector" } };
    public ctorOptions: any;
    public container: HTMLElement;
    public canvas: HTMLCanvasElement | null = null;
    public addControl = vi.fn();
    public removeControl = vi.fn();
    public easeTo = vi.fn();
    public fitBounds = vi.fn();
    public setFilter = vi.fn();
    public setLayerZoomRange = vi.fn();
    public setFeatureState = vi.fn();
    public removeFeatureState = vi.fn();
    public setLight = vi.fn();
    public triggerRepaint = vi.fn();
    public _locale: Record<string, unknown> = {};
    constructor(options?: any) {
      this.ctorOptions = options;
      this.container = options.container;
      if (options.locale) this._locale = { ...options.locale };
    }
    private find = (id: string) => this.layers.findIndex((l) => l.id === id);
    private mustFind = (id: string) => {
      const index = this.find(id);
      if (index < 0) throw new Error(`The layer '${id}' does not exist in the map's style.`);
      return index;
    };
    order = () => this.layers.map((l) => l.id);
    getContainer = () => this.container;
    getCanvasContainer = () => this.container;
    getCanvas() {
      if (!this.canvas) {
        this.canvas = document.createElement("canvas");
        this.container.appendChild(this.canvas);
      }
      return this.canvas;
    }
    getStyle = () => ({ layers: this.layers.map((l) => ({ ...l })), sources: { ...this.sources } });
    getLayer = (id: string) => this.layers[this.find(id)];
    addLayer = vi.fn((spec: any, before?: string) => {
      if (this.find(spec.id) >= 0) throw new Error(`Layer "${spec.id}" already exists on this map.`);
      const entry: StyleLayer = { paint: {}, layout: {}, ...spec, paint: { ...(spec.paint ?? {}) }, layout: { ...(spec.layout ?? {}) } };
      if (before === undefined) this.layers.push(entry);
      else this.layers.splice(this.mustFind(before), 0, entry);
    });
    removeLayer = vi.fn((id: string) => {
      this.layers.splice(this.mustFind(id), 1);
    });
    moveLayer = vi.fn((id: string, before?: string) => {
      const [entry] = this.layers.splice(this.mustFind(id), 1);
      if (before === undefined) this.layers.push(entry!);
      else this.layers.splice(this.mustFind(before), 0, entry!);
    });
    addSource = vi.fn((id: string, spec: any) => {
      if (this.sources[id]) throw new Error("There is already a source with this ID");
      this.sources[id] = { ...spec, setData: vi.fn() };
    });
    removeSource = vi.fn((id: string) => {
      delete this.sources[id];
    });
    getSource = (id: string) => this.sources[id];
    setPaintProperty = vi.fn((id: string, property: string, value: unknown) => {
      this.layers[this.mustFind(id)]!.paint[property] = value;
    });
    setLayoutProperty = vi.fn((id: string, property: string, value: unknown) => {
      this.layers[this.mustFind(id)]!.layout[property] = value;
    });
    getLayoutProperty = (id: string, property: string) => this.layers[this.find(id)]?.layout[property];
    on(event: string, cb: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(cb);
    }
    off(event: string, cb: Function) {
      this.events.get(event)?.delete(cb);
    }
    emit(event: string, data?: unknown) {
      this.events.get(event)?.forEach((cb) => cb(data));
    }
    remove() {}
  }
  const Popup = vi.fn(() => {
    const popup = popupInstance();
    popups.push(popup);
    return popup;
  });
  const Marker = vi.fn(() => {
    const marker = {
      setLngLat: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      getElement: vi.fn(() => document.createElement("div")),
      remove: vi.fn(),
    };
    markers.push(marker);
    return marker;
  });
  const AttributionControl = vi.fn(() => ({ type: "attribution" }));
  const NavigationControl = vi.fn(() => ({ type: "navigation" }));
  return {
    default: { Map: MockMap, AttributionControl, NavigationControl, Popup, Marker },
    Map: MockMap,
    AttributionControl,
    NavigationControl,
    Popup,
    Marker,
  };
});

import { MapRenderer, type MapRendererOptions } from "../../src/renderer/map-renderer";
import type { AppliedDocument } from "../../src/renderer/update/types";
import type { Layer } from "../../src/schemas/layer.schema";

const EMPTY = { type: "FeatureCollection", features: [] } as const;
const config = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/style.json" };

function circle(id: string, extra: Record<string, unknown> = {}): Layer {
  return { id, type: "circle", source: { type: "geojson", data: EMPTY }, paint: { "circle-color": "#f00" }, ...extra } as Layer;
}

function doc(layers: Layer[], options: AppliedDocument["options"] = {}, sources: AppliedDocument["sources"] = {}): AppliedDocument {
  return { config, layers, sources, options };
}

let container: HTMLElement;

/** A loaded renderer over `document`: the map's `load` fired and every layer was added. */
async function loaded(document: AppliedDocument, hostOptions: MapRendererOptions = {}) {
  const renderer = new MapRenderer(container, document.config, document.layers, { ...document.options, ...hostOptions }, document.sources);
  const ready = new Promise<void>((resolve) => renderer.on("load", resolve));
  (renderer.getMap() as any).emit("load");
  await ready;
  return renderer;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  popups.length = 0;
  markers.length = 0;
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("MapRenderer.update(): runtime features", () => {
  it("adding a markers block creates markers; removing popups destroys the popups manager (its popups close)", async () => {
    const renderer = await loaded(doc([circle("a")], { popups: [{ at: [0, 0], content: [{ str: "hi" }] }] as never }));
    expect(popups).toHaveLength(1);
    const added = vi.fn();
    renderer.on("markers:added", added);
    const result = await renderer.update(doc([circle("a")], { markers: [{ at: [1, 1] }, { at: [2, 2] }] as never }));
    expect(result.outcome).toBe("applied");
    expect(result.summary?.failures).toEqual([]);
    expect(popups[0]!.remove).toHaveBeenCalledTimes(1);
    expect(markers).toHaveLength(2);
    expect(added).toHaveBeenCalledWith({ count: 2 });
    // And back again: the markers go.
    await renderer.update(doc([circle("a")]));
    expect(markers.every((m) => m.remove.mock.calls.length === 1)).toBe(true);
  });

  it("changing classify.field re-seeds classify and the legend entry changes (AE11)", async () => {
    // A different field classifies over different breaks (`toModel` compiles them): the legend shows the breaks.
    const record = (field: string, breaks: number[]) => ({
      field,
      kind: "numeric",
      property: "circle-color",
      method: "quantile",
      classes: 2,
      breaks,
      colors: ["#111111", "#222222"],
    });
    const classified = (field: string, breaks: number[]) =>
      ({ ...circle("a", { label: "Areas" }), paint: { "circle-color": "#111111" }, metadata: { "maplibre-yaml:classify": record(field, breaks) } }) as Layer;
    const renderer = await loaded(doc([classified("pop", [5])]));
    const legend = () => container.querySelector(".ml-map-legend")?.textContent ?? "";
    expect(legend()).toContain("≥ 5");
    expect(legend()).not.toContain("≥ 50");
    const result = await renderer.update(doc([classified("area", [50])]));
    expect(result.outcome).toBe("applied");
    expect(result.summary?.failures).toEqual([]);
    expect(result.summary?.propertiesSet).toEqual([{ layerId: "a", property: "metadata" }]);
    expect(legend()).toContain("≥ 50");
    expect(legend()).not.toContain("≥ 5N"); // the old "≥ 5" line is gone
  });

  it("a projection change on a runtime without setProjection warns once and records no failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const renderer = await loaded(doc([circle("a")]));
    const result = await renderer.update(doc([circle("a")], { projection: { type: "globe" } as never }));
    expect(result.outcome).toBe("applied");
    expect(result.summary?.failures).toEqual([]);
    const projectionWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("setProjection"));
    expect(projectionWarnings).toHaveLength(1);
  });

  it("a title change renames the canvas; removing it restores the generic name", async () => {
    const renderer = await loaded(doc([circle("a")], { title: "Parks" }));
    const map = renderer.getMap() as any;
    const canvas = map.getCanvas() as HTMLCanvasElement;
    expect(canvas.getAttribute("aria-label")).toBe("Parks");
    await renderer.update(doc([circle("a")], { title: "Rivers", description: "Every river" }));
    expect(canvas.getAttribute("aria-label")).toBe("Rivers");
    expect(map._locale["Map.Title"]).toBe("Rivers");
    const described = canvas.getAttribute("aria-describedby")!;
    expect(container.querySelector(`#${described}`)?.textContent).toBe("Every river");
    await renderer.update(doc([circle("a")]));
    expect(canvas.getAttribute("aria-label")).toBe("Map");
    expect(canvas.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector(".ml-map-description")).toBeNull();
  });

  it("adding an effect: block calls the host's re-attach hook once; a paint-only change on that layer does not", async () => {
    const onReattachEffects = vi.fn();
    const renderer = await loaded(doc([circle("a")]), { onReattachEffects });
    await renderer.update(doc([circle("a", { effect: { type: "tonal-hatch" } })]));
    expect(onReattachEffects).toHaveBeenCalledTimes(1);
    await renderer.update(doc([circle("a", { effect: { type: "tonal-hatch" }, paint: { "circle-color": "#00f" } })]));
    expect(onReattachEffects).toHaveBeenCalledTimes(1);
  });

  it("a controls change swaps the controls, and a legend added later appears and can be taken away", async () => {
    const renderer = await loaded(doc([circle("a")]));
    const map = renderer.getMap() as any;
    expect(container.querySelector(".ml-map-legend")).toBeNull();
    const withEntry = circle("a", { legend: { label: "Dots", color: "#f00" } });
    await renderer.update(doc([withEntry], { controls: { navigation: true } as never, legend: { position: "bottom-left" } as never }));
    expect(map.addControl).toHaveBeenCalledWith(expect.objectContaining({ type: "navigation" }), expect.anything());
    expect(container.querySelector(".ml-map-legend")?.textContent).toContain("Dots");
    // `legend: false` takes it away even though the layer still carries an entry; the controls go with their block.
    await renderer.update(doc([withEntry], { legend: false }));
    expect(map.removeControl).toHaveBeenCalledWith(expect.objectContaining({ type: "navigation" }));
    expect(container.querySelector(".ml-map-legend")).toBeNull();
  });

  it("a camera change eases the map under document ownership and never under camera: 'host'", async () => {
    const moved = { ...config, center: [10, 20] as [number, number] };
    let renderer = await loaded(doc([circle("a")]));
    let result = await renderer.update({ ...doc([circle("a")]), config: moved });
    expect(result.summary?.cameraMoved).toBe(true);
    expect((renderer.getMap() as any).easeTo).toHaveBeenCalledWith({ center: [10, 20], duration: 300 });
    renderer = await loaded(doc([circle("a")]), { camera: "host" });
    result = await renderer.update({ ...doc([circle("a")]), config: moved });
    expect(result.summary?.cameraMoved).toBe(false);
    expect((renderer.getMap() as any).easeTo).not.toHaveBeenCalled();
  });

  it("a fitTo added in the next document frames its inline data once", async () => {
    const pts = { type: "geojson", data: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: {} }] } };
    const sources = { pts: pts as never };
    const renderer = await loaded(doc([{ id: "a", type: "circle", source: "pts", paint: {} } as Layer], {}, sources));
    const fit = vi.fn();
    renderer.on("camera:fit", fit);
    const withFit = { ...doc([{ id: "a", type: "circle", source: "pts", paint: {} } as Layer], {}, sources), config: { ...config, fitTo: { source: "pts" } } as never };
    const result = await renderer.update(withFit);
    expect(result.summary?.cameraMoved).toBe(true);
    expect((renderer.getMap() as any).fitBounds).toHaveBeenCalledTimes(1);
    expect(fit).toHaveBeenCalledWith({ source: "pts", bounds: [[1, 2], [1, 2]] });
    // The same fitTo again, with a paint change: no second fit.
    await renderer.update({ ...withFit, layers: [{ id: "a", type: "circle", source: "pts", paint: { "circle-color": "#00f" } } as Layer] });
    expect((renderer.getMap() as any).fitBounds).toHaveBeenCalledTimes(1);
  });

  it("adding hover.highlight over a named GeoJSON source rebuilds the source with generateId: true, from the next document's layers (ml-aot.142)", async () => {
    const pts = { type: "geojson", data: EMPTY } as never;
    const plain = { id: "a", type: "circle", source: "pts", paint: { "circle-color": "#f00" } } as Layer;
    const renderer = await loaded(doc([plain], {}, { pts }));
    const map = renderer.getMap() as any;
    expect(map.addSource).toHaveBeenCalledWith("pts", expect.not.objectContaining({ generateId: true }));
    map.addSource.mockClear();

    const hovered = { ...plain, interactive: { hover: { highlight: true } } } as Layer;
    const result = await renderer.update(doc([hovered], {}, { pts }));

    expect(result.outcome).toBe("applied");
    expect(result.summary?.failures).toEqual([]);
    expect(result.summary?.sourcesReplaced).toEqual(["pts"]);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledWith("pts", expect.objectContaining({ generateId: true }));
    // The hover paint wrapping reads the feature-state the ids make addressable.
    expect(JSON.stringify(map.getLayer("a").paint["circle-color"])).toContain("feature-state");

    // And back: a source nothing highlights any more is rebuilt without ids.
    map.addSource.mockClear();
    await renderer.update(doc([plain], {}, { pts }));
    expect(map.addSource).toHaveBeenCalledWith("pts", expect.not.objectContaining({ generateId: true }));
  });
});

describe("MapRenderer.update(): the review sweep", () => {
  it("an equal document fires no update:applied — unless the hints say reload, which answers with an empty summary (KTD11)", async () => {
    const renderer = await loaded(doc([circle("a")]));
    const applied = vi.fn();
    renderer.on("update:applied", applied);
    const same = await renderer.update(doc([circle("a")]));
    expect(same.outcome).toBe("applied");
    expect(applied).not.toHaveBeenCalled();
    const reloaded = await renderer.update(doc([circle("a")]), { failedSources: new Set(), urlsRebased: false, reload: true });
    expect(reloaded.outcome).toBe("applied");
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied.mock.calls[0]![0].summary).toMatchObject({ rebuild: false, failures: [], added: [], replaced: [], propertiesSet: [] });
  });

  it("an equal document after a fitTo prefetch render is a no-op: the host's prefetchedData is not the document's (KTD1)", async () => {
    const data = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [1, 1] }, properties: {} }] };
    const fetcher = { fetch: vi.fn(async () => ({ data, fromCache: false, featureCount: 1, duration: 0 })) };
    const source = { type: "geojson", url: "/pts.geojson" };
    const layer = { id: "a", type: "circle", source: "pts" } as Layer;
    const fitConfig = { ...config, fitTo: { source: "pts" } } as never;
    const renderer = new MapRenderer(
      container,
      fitConfig,
      [layer],
      { sourceData: { fetcher: fetcher as never, pending: { pts: Promise.resolve(data as never) } } },
      { pts: { ...source, prefetchedData: data } as never }
    );
    const ready = new Promise<void>((resolve) => renderer.on("load", resolve));
    (renderer.getMap() as any).emit("load");
    await ready;
    const applied = vi.fn();
    renderer.on("update:applied", applied);
    const result = await renderer.update({ config: fitConfig, layers: [layer], sources: { pts: source as never }, options: {} });
    expect(result.outcome).toBe("applied");
    expect(result.summary).toMatchObject({ sourcesReplaced: [], replaced: [], propertiesSet: [], cameraMoved: false, failures: [] });
    expect(applied).not.toHaveBeenCalled();
  });

  it("a MapLibre error for a layer or source an update added is classified as the document's (the classifier reads the applied document)", async () => {
    const onError = vi.fn();
    const renderer = await loaded(doc([circle("a")]), { onError });
    const map = renderer.getMap() as any;
    await renderer.update(doc([circle("a"), circle("b")]));
    map.emit("error", { error: new Error("layers.b.paint.circle-color: bad"), layer: { id: "b" } });
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), false, { kind: "layer", layerId: "b" });
    await renderer.update(doc([circle("a"), { id: "c", type: "circle", source: "pts" } as Layer], {}, { pts: { type: "geojson", data: EMPTY } as never }));
    map.emit("error", { error: new Error("tiles 404"), sourceId: "pts" });
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), false, { kind: "source", sourceId: "pts" });
    // A layer the update removed is no longer the document's.
    await renderer.update(doc([circle("a")]));
    map.emit("error", { error: new Error("layers.b.paint.circle-color: bad"), layer: { id: "b" } });
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), false, undefined);
  });

  it("update() before the map loads resolves superseded when the renderer is destroyed first", async () => {
    const renderer = new MapRenderer(container, config, [circle("a")], {});
    const pending = renderer.update(doc([circle("a", { paint: { "circle-color": "#0f0" } })]));
    renderer.destroy();
    await expect(pending).resolves.toEqual({ outcome: "superseded" });
  });
});

describe("MapRenderer: a tile source whose TileJSON request failed is a failed source (ml-7qa.13)", () => {
  const tiled = { type: "vector", url: "pmtiles://https://example.com/districts.pmtiles" };
  const lines = { id: "d", type: "line", source: "tiled", "source-layer": "districts" } as Layer;
  const chunkFailure = () =>
    Object.assign(new Error("The PMTiles reader (`chunks/pmtiles.js`) couldn't be downloaded."), {
      failure: { code: "chunk", format: "pmtiles", url: "chunks/pmtiles.js" },
    });

  it("its reader chunk failing is listed, reload() re-sets its url, and its metadata loading clears it", async () => {
    const renderer = await loaded(doc([lines], {}, { tiled: tiled as never }));
    const map = renderer.getMap() as any;
    const setUrl = vi.fn();
    map.getSource("tiled").setUrl = setUrl;
    map.emit("error", { error: chunkFailure(), sourceId: "tiled" });
    expect([...renderer.failedSources()]).toEqual(["tiled"]);

    const result = await renderer.update(doc([lines], {}, { tiled: tiled as never }), {
      failedSources: renderer.failedSources(),
      urlsRebased: false,
      reload: true,
    });
    expect(result.outcome).toBe("applied");
    expect(result.summary?.failures).toEqual([]);
    expect(setUrl).toHaveBeenCalledTimes(1);
    expect(setUrl).toHaveBeenCalledWith(tiled.url);

    const retried = vi.fn();
    renderer.on("source:retried", retried);
    map.emit("sourcedata", { sourceId: "tiled", sourceDataType: "metadata" });
    expect(renderer.failedSources().size).toBe(0);
    // Once: the notice's line for it goes (ml-map), and a later metadata event says nothing.
    map.emit("sourcedata", { sourceId: "tiled", sourceDataType: "metadata" });
    expect(retried.mock.calls).toEqual([[{ sourceId: "tiled" }]]);
  });

  it("a failed tile (an ordinary 404) is not a failed source", async () => {
    const renderer = await loaded(doc([lines], {}, { tiled: tiled as never }));
    const map = renderer.getMap() as any;
    map.emit("error", { error: new Error("404"), sourceId: "tiled", tile: { tileID: {} } });
    expect(renderer.failedSources().size).toBe(0);
  });

  it("a basemap's source failing is not the document's", async () => {
    const renderer = await loaded(doc([lines], {}, { tiled: tiled as never }));
    const map = renderer.getMap() as any;
    map.emit("error", { error: chunkFailure(), sourceId: "basemap" });
    expect(renderer.failedSources().size).toBe(0);
  });
});
