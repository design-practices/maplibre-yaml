/**
 * @file U14 renderer surface: `fitTo` resolution, standalone `popups:`, and
 * the `color-relief` runtime floor (declared absence below maplibre-gl 5.6).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const popupInstances: any[] = [];
const runtime = { version: "5.24.0" as string | undefined };

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events: Map<string, Set<Function>> = new Map();
    public ctorOptions: any;
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn();
    public fitBounds = vi.fn();
    public addControl = vi.fn();
    constructor(options?: any) {
      this.ctorOptions = options;
    }
    get version() {
      return runtime.version;
    }
    getCanvas() {
      return { style: { cursor: "" } };
    }
    on(event: string, callback: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(callback);
    }
    off() {}
    emit(event: string, data?: any) {
      this.events.get(event)?.forEach((cb) => cb(data));
    }
    remove() {}
  }
  const Popup = vi.fn((options?: any) => {
    const instance = {
      options,
      html: "",
      lngLat: null as unknown,
      setLngLat: vi.fn(function (this: any, at: unknown) {
        this.lngLat = at;
        return this;
      }),
      setHTML: vi.fn(function (this: any, html: string) {
        this.html = html;
        return this;
      }),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      on: vi.fn(),
    };
    popupInstances.push(instance);
    return instance;
  });
  const getVersion = () => runtime.version;
  // The renderer always adds its own (sanitizing) attribution control
  // (GHSA-jrc7-96c5-q579, attribution-guard.ts).
  const AttributionControl = vi.fn(() => ({ type: "attribution" }));
  const mod = { Map: MockMap, Popup, getVersion, AttributionControl };
  return { default: mod, ...mod };
});

import { MapRenderer } from "../../src/renderer/map-renderer";
import { PopupsManager } from "../../src/renderer/popups-manager";

const LINE = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "LineString",
    coordinates: [
      [-77.03, 38.89],
      [-77.0, 38.88],
    ],
  },
};
const BASE = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://x/s.json" };

describe("fitTo (U14)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("inline data: the map is constructed already framed; fitTo never reaches MapLibre", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "route", padding: 20, maxZoom: 15 } } as any,
      [],
      {},
      { route: { type: "geojson", data: LINE } } as any
    );
    const opts = (renderer.getMap() as any).ctorOptions;
    expect(opts.fitTo).toBeUndefined();
    expect(opts.bounds).toEqual([
      [-77.03, 38.88],
      [-77.0, 38.89],
    ]);
    expect(opts.fitBoundsOptions).toEqual({ padding: 20, maxZoom: 15 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("a url: source whose data the host prefetched is framed at construction too (ml-aot.75)", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "route", padding: 10 } } as any,
      [],
      {},
      { route: { type: "geojson", url: "data/route.geojson", prefetchedData: LINE } } as any
    );
    const opts = (renderer.getMap() as any).ctorOptions;
    expect(opts.bounds).toEqual([
      [-77.03, 38.88],
      [-77.0, 38.89],
    ]);
    expect(opts.fitBoundsOptions).toEqual({ padding: 10 });
  });

  it("bounds: with fitBoundsOptions (the Astro builders' padding, ml-aot.131) reach the constructor", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, bounds: [-77.03, 38.88, -77.0, 38.89], fitBoundsOptions: { padding: 50 } } as any,
      [],
      {},
      {}
    );
    const opts = (renderer.getMap() as any).ctorOptions;
    expect(opts.bounds).toEqual([-77.03, 38.88, -77.0, 38.89]);
    expect(opts.fitBoundsOptions).toEqual({ padding: 50 });
  });

  it("announces the inline fit on load as camera:fit", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "route" } } as any,
      [],
      {},
      { route: { type: "geojson", data: LINE } } as any
    );
    const seen: unknown[] = [];
    renderer.on("camera:fit", (e) => seen.push(e));
    (renderer.getMap() as any).emit("load");
    expect(seen).toEqual([
      { source: "route", bounds: [[-77.03, 38.88], [-77.0, 38.89]] },
    ]);
  });

  it("a source read by view is framed no further out than its minzoom: the map opens where data loads (M1)", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "lots" } } as any,
      [],
      {},
      { lots: { type: "geojson", url: "/data/lots.parquet", load: "viewport" } } as any
    );
    const map = renderer.getMap() as any;
    const extent = [[-74.26, 40.49], [-73.7, 40.92]];
    map.cameraForBounds = vi.fn(() => ({ center: { lng: -73.98, lat: 40.7 }, zoom: 9.92 }));
    map.jumpTo = vi.fn();
    const layers = (renderer as any).layerManager;
    layers.getSourceExtent = () => extent;
    layers.getViewMinzoom = () => 10;
    const seen: unknown[] = [];
    renderer.on("camera:fit", (e) => seen.push(e));
    layers.callbacks.onDataLoaded("lots", 0);
    expect(map.jumpTo).toHaveBeenCalledWith({ center: { lng: -73.98, lat: 40.7 }, zoom: 10 });
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(seen).toEqual([{ source: "lots", bounds: extent }]);
  });

  it("a source read by view too dense at its minzoom is framed at the outermost zoom whose view is read (PR #206 verification)", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "lots" } } as any,
      [],
      {},
      { lots: { type: "geojson", url: "/data/lots.parquet", load: "viewport" } } as any
    );
    const map = renderer.getMap() as any;
    map.cameraForBounds = vi.fn(() => ({ center: { lng: -73.98, lat: 40.7 }, zoom: 9.92 }));
    map.jumpTo = vi.fn();
    const layers = (renderer as any).layerManager;
    layers.getSourceExtent = () => [[-74.26, 40.49], [-73.7, 40.92]];
    layers.getViewMinzoom = () => 10;
    const fits = vi.fn(() => 12.25);
    layers.getViewZoomThatFits = fits;
    layers.callbacks.onDataLoaded("lots", 0);
    expect(fits).toHaveBeenCalledWith("lots", [-73.98, 40.7], 9.92, expect.any(Number), expect.any(Number));
    expect(map.jumpTo).toHaveBeenCalledWith({ center: { lng: -73.98, lat: 40.7 }, zoom: 12.25 });
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("the author's fitTo.maxZoom still caps it (but never below minzoom)", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "lots", maxZoom: 11 } } as any,
      [],
      {},
      { lots: { type: "geojson", url: "/data/lots.parquet", load: "viewport" } } as any
    );
    const map = renderer.getMap() as any;
    map.cameraForBounds = vi.fn(() => ({ center: { lng: -73.98, lat: 40.7 }, zoom: 9.92 }));
    map.jumpTo = vi.fn();
    const layers = (renderer as any).layerManager;
    layers.getSourceExtent = () => [[-74.26, 40.49], [-73.7, 40.92]];
    layers.getViewMinzoom = () => 10;
    layers.getViewZoomThatFits = () => 12.25;
    layers.callbacks.onDataLoaded("lots", 0);
    expect(map.jumpTo).toHaveBeenCalledWith({ center: { lng: -73.98, lat: 40.7 }, zoom: 11 });
  });

  it("a source read by view whose extent frames at or above its minzoom is fitted as usual", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "lots", maxZoom: 16 } } as any,
      [],
      {},
      { lots: { type: "geojson", url: "/data/lots.parquet", load: "viewport" } } as any
    );
    const map = renderer.getMap() as any;
    map.cameraForBounds = vi.fn(() => ({ center: { lng: -73.98, lat: 40.7 }, zoom: 14 }));
    map.jumpTo = vi.fn();
    const layers = (renderer as any).layerManager;
    layers.getSourceExtent = () => [[-74, 40.69], [-73.97, 40.71]];
    layers.getViewMinzoom = () => 10;
    layers.callbacks.onDataLoaded("lots", 0);
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledWith([[-74, 40.69], [-73.97, 40.71]], expect.objectContaining({ maxZoom: 16, animate: false }));
  });

  it("a tiled source warns once and keeps the authored camera", () => {
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "tiles" } } as any,
      [],
      {},
      { tiles: { type: "vector", url: "https://x/t.json" } } as any
    );
    expect((renderer.getMap() as any).ctorOptions.bounds).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/only GeoJSON sources/);
  });

  it("an unknown source name warns with the move-it-to-sources hint", () => {
    new MapRenderer(document.createElement("div"), { ...BASE, fitTo: { source: "nope" } } as any);
    expect(String(warn.mock.calls[0]![0])).toMatch(/names no entry in `sources:`/);
  });

  it("a fitTo.source typo is reported to the host on load, with the did-you-mean (ml-aot.51)", () => {
    const onError = vi.fn();
    const renderer = new MapRenderer(
      document.createElement("div"),
      { ...BASE, fitTo: { source: "place" } } as any,
      [],
      { onError },
      { places: { type: "geojson", url: "/data/places.geojson" } } as any
    );
    expect(String(warn.mock.calls[0]![0])).toContain('did you mean "places"?');
    (renderer.getMap() as any).emit("load");
    const fit = onError.mock.calls.find((c) => c[2]?.kind === "fit");
    expect(fit).toBeDefined();
    expect(fit![1]).toBe(false);
    expect(fit![2]).toEqual({ kind: "fit", sourceId: "place", suggestion: "places" });
  });
});

describe("PopupsManager (U14)", () => {
  beforeEach(() => {
    popupInstances.length = 0;
  });

  it("opens each popup at its coordinate through the trust gate", () => {
    const manager = new PopupsManager({} as any);
    manager.add([
      {
        at: [-96, 37.8],
        closeOnClick: false,
        content: [{ h1: [{ str: "Hello <World>!" }] }],
      },
    ] as any);
    const [popup] = popupInstances;
    expect(popup.options).toEqual({ closeOnClick: false });
    expect(popup.lngLat).toEqual([-96, 37.8]);
    // Escaped through PopupBuilder — text, never markup.
    expect(popup.html).toContain("<h1>");
    expect(popup.html).toContain("Hello &lt;World&gt;!");
    expect(popup.addTo).toHaveBeenCalled();
  });

  it("passes only authored options, so MapLibre defaults apply otherwise", () => {
    new PopupsManager({} as any).add([{ at: [0, 0], content: [] }] as any);
    expect(popupInstances[0].options).toEqual({});
  });

  it("destroy() removes every popup", () => {
    const manager = new PopupsManager({} as any);
    manager.add([
      { at: [0, 0], content: [] },
      { at: [1, 1], content: [] },
    ] as any);
    manager.destroy();
    expect(popupInstances.every((p) => p.remove.mock.calls.length === 1)).toBe(true);
  });
});

describe("color-relief runtime floor (U14)", () => {
  const RELIEF = {
    id: "relief",
    type: "color-relief",
    source: { type: "raster-dem", tiles: ["https://x/{z}/{x}/{y}.png"] },
    paint: { "color-relief-opacity": 0.8 },
  } as any;

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    runtime.version = "5.24.0";
  });

  it("below 5.6: skipped with ONE warning, no layer:added, nothing reaches MapLibre", async () => {
    runtime.version = "4.7.1";
    const renderer = new MapRenderer(document.createElement("div"), BASE as any);
    const added: unknown[] = [];
    renderer.on("layer:added", (e) => added.push(e));
    await renderer.addLayer(RELIEF);
    await renderer.addLayer({ ...RELIEF, id: "relief-2" });
    const map = renderer.getMap() as any;
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();
    expect(added).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/color-relief.*5\.6\.0.*4\.7\.1/);
  });

  it("at 5.6+: added like any layer", async () => {
    runtime.version = "5.6.0";
    const renderer = new MapRenderer(document.createElement("div"), BASE as any);
    await renderer.addLayer(RELIEF);
    const map = renderer.getMap() as any;
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "relief", type: "color-relief" }),
      undefined
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("an unreported version is not a claim — the layer is attempted", async () => {
    runtime.version = undefined;
    const renderer = new MapRenderer(document.createElement("div"), BASE as any);
    await renderer.addLayer(RELIEF);
    expect((renderer.getMap() as any).addLayer).toHaveBeenCalled();
  });
});
