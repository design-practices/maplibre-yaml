/**
 * @file The Map constructor sees the runtime's shape of each 6.x option (ml-vwz)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * What `MapRenderer` hands `new Map(...)` and the live-update setters, by
 * the running maplibre-gl version (`getVersion()`):
 *
 * - `state:` defaults ride in as `globalState` from 6.14 (the first frame
 *   reads them) and are still written with `setGlobalStateProperty` on load
 *   (a `setStyle` resets them, and live updates go through the setter);
 *   below 6.14 only the setter path.
 * - `dragRotate: { around: 'pointer' }` passes through from 6.15; below it
 *   the map gets `true` and one warning.
 * - `maxBounds: [-Infinity, s, Infinity, n]` passes through from 6.16;
 *   below it the longitude closes at ±180 and one warning.
 * - a live update of `dragRotate` goes through `map.dragRotate.enable /
 *   disable`, of `maxBounds` through `setMaxBounds`, both with the same
 *   runtime shaping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const runtime = vi.hoisted(() => ({ version: "6.18.0" }));

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
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
    public hasImage = vi.fn(() => false);
    public addImage = vi.fn();
    public setGlobalStateProperty = vi.fn();
    public setMaxBounds = vi.fn();
    public setMinZoom = vi.fn();
    public setMaxZoom = vi.fn();
    public dragRotate = { enable: vi.fn(), disable: vi.fn() };
    public setStyle = vi.fn();
    public _locale: Record<string, unknown> = {};
    private layers: any[] = [];
    private sources: Record<string, any> = {};
    constructor(options?: any) {
      this.ctorOptions = options;
      this.container = options.container;
    }
    getContainer = () => this.container;
    getCanvasContainer = () => this.container;
    getCanvas() {
      if (!this.canvas) {
        this.canvas = document.createElement("canvas");
        this.container.appendChild(this.canvas);
      }
      return this.canvas;
    }
    getStyle = () => ({ layers: [...this.layers], sources: { ...this.sources } });
    getLayer = (id: string) => this.layers.find((l) => l.id === id);
    addLayer = vi.fn((spec: any) => {
      this.layers.push({ paint: {}, layout: {}, ...spec });
    });
    removeLayer = vi.fn();
    moveLayer = vi.fn();
    addSource = vi.fn((id: string, spec: any) => {
      this.sources[id] = { ...spec, setData: vi.fn() };
    });
    removeSource = vi.fn();
    getSource = (id: string) => this.sources[id];
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    getLayoutProperty = vi.fn();
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
  const AttributionControl = vi.fn(() => ({ type: "attribution" }));
  const NavigationControl = vi.fn(() => ({ type: "navigation" }));
  const Popup = vi.fn();
  const Marker = vi.fn();
  const getVersion = () => runtime.version;
  return {
    default: { Map: MockMap, AttributionControl, NavigationControl, Popup, Marker, getVersion },
    Map: MockMap,
    AttributionControl,
    NavigationControl,
    Popup,
    Marker,
    getVersion,
  };
});

import { MapRenderer, type MapRendererOptions } from "../../src/renderer/map-renderer";
import type { MapConfig } from "../../src/schemas/map.schema";

const BASE: MapConfig = { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" } as MapConfig;
const STATE = { year: { default: 2010 } };

let container: HTMLElement;
let warn: ReturnType<typeof vi.spyOn>;

function render(config: Partial<MapConfig>, options: MapRendererOptions = {}) {
  const renderer = new MapRenderer(container, { ...BASE, ...config } as MapConfig, [], options);
  const map = renderer.getMap() as any;
  return { renderer, map, ctor: map.ctorOptions as Record<string, unknown> };
}

/** The renderer after its map's `load` fired. */
async function loaded(config: Partial<MapConfig>, options: MapRendererOptions = {}) {
  const r = render(config, options);
  const ready = new Promise<void>((resolve) => r.renderer.on("load", resolve));
  r.map.emit("load");
  await ready;
  return r;
}

const warnings = () => warn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  runtime.version = "6.18.0";
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("state: defaults at construction (globalState, 6.14)", () => {
  it("on 6.14 the constructor gets the defaults as globalState, and load still writes them", async () => {
    runtime.version = "6.14.0";
    const { ctor, map } = await loaded({}, { state: STATE });
    expect(ctor["globalState"]).toEqual({ year: 2010 });
    expect(map.setGlobalStateProperty.mock.calls).toEqual([["year", 2010]]);
  });

  it("on 5.x the constructor gets no globalState; the setter applies the defaults on load", async () => {
    runtime.version = "5.6.0";
    const { ctor, map } = await loaded({}, { state: STATE });
    expect("globalState" in ctor).toBe(false);
    expect(map.setGlobalStateProperty.mock.calls).toEqual([["year", 2010]]);
  });

  it("a document without state: adds no globalState on any runtime", () => {
    runtime.version = "6.18.0";
    expect("globalState" in render({}).ctor).toBe(false);
  });

  it("a host's config.globalState is replaced by the document's state: defaults (one source of truth)", () => {
    runtime.version = "6.18.0";
    const { ctor } = render({ globalState: { year: 1999, other: 1 } } as never, { state: STATE });
    expect(ctor["globalState"]).toEqual({ year: 2010 });
  });
});

describe("dragRotate (6.15: around pointer / center)", () => {
  it("on 6.15 the options object reaches the constructor as written", () => {
    runtime.version = "6.15.0";
    const value = { around: "pointer" as const };
    expect(render({ dragRotate: value } as never).ctor["dragRotate"]).toEqual(value);
    expect(warnings()).toEqual([]);
  });

  it("on 6.12 the constructor gets true and one warning names the floor", () => {
    runtime.version = "6.12.0";
    const { ctor } = render({ dragRotate: { around: "center", movement: "linear" } } as never);
    expect(ctor["dragRotate"]).toBe(true);
    const notice = warnings().filter((w) => w.includes("dragRotate"));
    expect(notice).toHaveLength(1);
    expect(notice[0]).toContain("6.15.0");
  });

  it("booleans pass through unchanged on any runtime", () => {
    runtime.version = "6.12.0";
    expect(render({ dragRotate: false }).ctor["dragRotate"]).toBe(false);
    expect(warnings()).toEqual([]);
  });
});

describe("maxBounds with an open longitude (6.16)", () => {
  const OPEN = [-Infinity, 40.5, Infinity, 40.9] as unknown as MapConfig["maxBounds"];

  it("on 6.16 the open bounds reach the constructor as written", () => {
    runtime.version = "6.16.0";
    expect(render({ maxBounds: OPEN }).ctor["maxBounds"]).toEqual([-Infinity, 40.5, Infinity, 40.9]);
    expect(warnings()).toEqual([]);
  });

  it("on 6.12 the longitude closes at ±180 and one warning names the floor", () => {
    runtime.version = "6.12.0";
    expect(render({ maxBounds: OPEN }).ctor["maxBounds"]).toEqual([-180, 40.5, 180, 40.9]);
    const notice = warnings().filter((w) => w.includes("maxBounds"));
    expect(notice).toHaveLength(1);
    expect(notice[0]).toContain("6.16.0");
  });

  it("finite bounds pass through unchanged", () => {
    runtime.version = "6.12.0";
    expect(render({ maxBounds: [-74.3, 40.5, -73.7, 40.9] }).ctor["maxBounds"]).toEqual([-74.3, 40.5, -73.7, 40.9]);
    expect(warnings()).toEqual([]);
  });
});

describe("live updates (the runtime host)", () => {
  it("a changed dragRotate enables or disables the handler with the runtime's shape; no rebuild", async () => {
    runtime.version = "6.18.0";
    const { renderer, map } = await loaded({ dragRotate: true });
    const next = { config: { ...BASE, dragRotate: { around: "pointer" } }, layers: [], sources: {}, options: {} };
    const result = await renderer.update(next as never);
    expect(result.outcome).toBe("applied");
    expect(map.dragRotate.enable).toHaveBeenCalledWith({ around: "pointer" });
    const off = await renderer.update({ ...next, config: { ...BASE, dragRotate: false } } as never);
    expect(off.outcome).toBe("applied");
    expect(map.dragRotate.disable).toHaveBeenCalledTimes(1);
  });

  it("a changed dragRotate object below the floor enables plainly, with the one notice", async () => {
    runtime.version = "6.12.0";
    const { renderer, map } = await loaded({ dragRotate: true });
    await renderer.update({ config: { ...BASE, dragRotate: { around: "pointer" } }, layers: [], sources: {}, options: {} } as never);
    expect(map.dragRotate.enable).toHaveBeenCalledWith(true);
    expect(warnings().filter((w) => w.includes("dragRotate"))).toHaveLength(1);
  });

  it("a changed maxBounds goes through setMaxBounds with the runtime's shape", async () => {
    runtime.version = "6.12.0";
    const { renderer, map } = await loaded({});
    await renderer.update({ config: { ...BASE, maxBounds: [-Infinity, 40.5, Infinity, 40.9] }, layers: [], sources: {}, options: {} } as never);
    expect(map.setMaxBounds).toHaveBeenCalledWith([-180, 40.5, 180, 40.9]);
    runtime.version = "6.18.0";
    await renderer.update({ config: { ...BASE, maxBounds: [-Infinity, 40.5, Infinity, 40.9] }, layers: [], sources: {}, options: {} } as never);
    await renderer.update({ config: { ...BASE }, layers: [], sources: {}, options: {} } as never);
    expect(map.setMaxBounds).toHaveBeenLastCalledWith(null);
  });
});
