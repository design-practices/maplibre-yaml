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
