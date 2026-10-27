/**
 * @file The state surface: `setState`, `getState`, provenance, the panel and the reapply (live documents, U5)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * The renderer holds the document's `state:` values with provenance (KTD6):
 * the document's defaults, the panel's range-midpoint seeds and a reader's
 * writes (`setState` or the panel). This proves the public pair, the
 * `state:change` event, the default-change and key-removal rules across
 * `update()`, visibility overrides across a panel rebuild, the carried
 * `initialState` / `initialVisibility`, the queued write before load, and
 * the ml-u0l regression: every current value is written again after any
 * `style.load`, the renderer's own `setStyle` (a Protomaps basemap) and a
 * host's alike. Each test maps to one bullet of the plan's U5 test
 * scenarios (docs/plans/2026-10-27-001-feat-live-documents-plan.md).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    public hasImage = vi.fn(() => false);
    public addImage = vi.fn();
    /** `global-state` writes, the subject of every assertion here. */
    public setGlobalStateProperty = vi.fn();
    /** As MapLibre: a new style resets global state and announces itself with `style.load`, asynchronously. */
    public setStyle = vi.fn(() => {
      this.setGlobalStateProperty.mockClear();
      void Promise.resolve().then(() => this.emit("style.load"));
    });
    public _locale: Record<string, unknown> = {};
    constructor(options?: any) {
      this.ctorOptions = options;
      this.container = options.container;
    }
    private find = (id: string) => this.layers.findIndex((l) => l.id === id);
    private mustFind = (id: string) => {
      const index = this.find(id);
      if (index < 0) throw new Error(`The layer '${id}' does not exist in the map's style.`);
      return index;
    };
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
    moveLayer = vi.fn();
    addSource = vi.fn((id: string, spec: any) => {
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
  const AttributionControl = vi.fn(() => ({ type: "attribution" }));
  const NavigationControl = vi.fn(() => ({ type: "navigation" }));
  const Popup = vi.fn();
  const Marker = vi.fn();
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

function doc(layers: Layer[], options: AppliedDocument["options"] = {}): AppliedDocument {
  return { config, layers, sources: {}, options };
}

/** A document declaring `year` with a slider for it and one labelled (toggleable) layer. */
const YEAR = {
  parameters: { year: { type: "range", min: 2000, max: 2030, step: 1 } },
  state: { year: { default: 2010 } },
};
const years = (extra: AppliedDocument["options"] = {}, layers = [circle("a", { label: "Points" })]) =>
  doc(layers, { ...YEAR, ...extra });

let container: HTMLElement;

type Events = { state: Array<{ values: Record<string, unknown>; changed: string[] }>; parameter: unknown[] };

function listen(renderer: MapRenderer): Events {
  const events: Events = { state: [], parameter: [] };
  renderer.on("state:change", (e) => events.state.push(e));
  renderer.on("parameter:change", (e) => events.parameter.push(e));
  return events;
}

/** A loaded renderer over `document`: the map's `load` fired and every layer was added. */
async function loaded(document: AppliedDocument, hostOptions: MapRendererOptions = {}) {
  const renderer = new MapRenderer(container, document.config, document.layers, { ...document.options, ...hostOptions }, document.sources);
  const events = listen(renderer);
  const ready = new Promise<void>((resolve) => renderer.on("load", resolve));
  (renderer.getMap() as any).emit("load");
  await ready;
  return { renderer, map: renderer.getMap() as any, events };
}

const slider = () => container.querySelector(".ml-map-params input[type=range]") as HTMLInputElement;
const toggles = () => [...container.querySelectorAll<HTMLInputElement>(".ml-map-params-layer input")];
const stateCalls = (map: any) => (map.setGlobalStateProperty as ReturnType<typeof vi.fn>).mock.calls;

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ml-u0l: state: defaults survive a setStyle()", () => {
  it("the renderer's own setStyle (a Protomaps basemap) is followed by a reapply of every current value", async () => {
    const protomaps = doc([], { state: { year: { default: 2010 } } });
    const renderer = new MapRenderer(
      container,
      { ...config, mapStyle: { pmtiles: "data/nyc.pmtiles" } } as never,
      [],
      protomaps.options
    );
    const map = renderer.getMap() as any;
    const ready = new Promise<void>((resolve) => renderer.on("load", resolve));
    map.emit("load");
    await ready;
    expect(stateCalls(map)).toEqual([["year", 2010]]);

    // The generated basemap lands: setStyle resets global state (the mock clears the calls as MapLibre clears the state).
    await until(() => map.setStyle.mock.calls.length > 0);
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    await until(() => stateCalls(map).length > 0);
    expect(stateCalls(map)).toEqual([["year", 2010]]);
    renderer.destroy();
  });

  it("a host's setStyle after a panel write reapplies the reader's value, not the default (AE9, F5)", async () => {
    const { map } = await loaded(years());
    const input = slider();
    input.value = "2020";
    input.dispatchEvent(new Event("input"));
    expect(stateCalls(map)).toEqual([["year", 2010], ["year", 2020]]);

    map.setStyle({ version: 8, sources: {}, layers: [] });
    await until(() => stateCalls(map).length > 0);
    expect(stateCalls(map)).toEqual([["year", 2020]]);
  });
});

describe("setState / getState", () => {
  it("an undeclared key rejects the whole call, naming it, and calls no setter (AE7)", async () => {
    const { renderer, map, events } = await loaded(years());
    map.setGlobalStateProperty.mockClear();
    expect(() => renderer.setState({ year: 2020, month: 3 })).toThrow(/month/);
    expect(map.setGlobalStateProperty).not.toHaveBeenCalled();
    expect(renderer.getState()).toEqual({ year: 2010 });
    expect(events.state).toEqual([]);
  });

  it("a declared key writes through setGlobalStateProperty, the panel shows it, one state:change fires (AE8)", async () => {
    const { renderer, map, events } = await loaded(years());
    renderer.setState({ year: 2020 });
    expect(map.setGlobalStateProperty).toHaveBeenLastCalledWith("year", 2020);
    expect(slider().value).toBe("2020");
    expect(renderer.getState()).toEqual({ year: 2020 });
    expect(events.state).toEqual([{ values: { year: 2020 }, changed: ["year"] }]);
    expect(events.parameter).toEqual([]);
  });

  it("getState() starts from the document's defaults", async () => {
    const { renderer } = await loaded(doc([], { state: { year: { default: 2010 }, mode: { default: "all" }, empty: {} } }));
    expect(renderer.getState()).toEqual({ year: 2010, mode: "all" });
  });

  it("a panel slider change fires exactly one parameter:change and one state:change, and getState() reflects it", async () => {
    const { renderer, events } = await loaded(years());
    const input = slider();
    input.value = "2025";
    input.dispatchEvent(new Event("input"));
    expect(events.parameter).toEqual([{ key: "year", value: 2025 }]);
    expect(events.state).toEqual([{ values: { year: 2025 }, changed: ["year"] }]);
    expect(renderer.getState()).toEqual({ year: 2025 });
  });

  it("below maplibre-gl 5.6, setState throws the once-warned message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = new MapRenderer(container, config, [], { state: { year: { default: 2010 } } });
    const map = renderer.getMap() as any;
    delete map.setGlobalStateProperty;
    map.emit("load");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("setGlobalStateProperty"))).toHaveLength(1);
    expect(() => renderer.setState({ year: 2020 })).toThrow(/setGlobalStateProperty \(needs >= 5\.6\)/);
  });
});

describe("provenance across update() (KTD6)", () => {
  it("a changed default replaces a value the reader never touched, and never one the reader set", async () => {
    const { renderer, map, events } = await loaded(years());
    await renderer.update(years({ state: { year: { default: 2015 } } }));
    expect(renderer.getState()).toEqual({ year: 2015 });
    expect(map.setGlobalStateProperty).toHaveBeenLastCalledWith("year", 2015);
    expect(slider().value).toBe("2015");
    expect(events.state).toEqual([{ values: { year: 2015 }, changed: ["year"] }]);

    renderer.setState({ year: 2020 });
    map.setGlobalStateProperty.mockClear();
    await renderer.update(years({ state: { year: { default: 2018 } } }));
    expect(renderer.getState()).toEqual({ year: 2020 });
    expect(map.setGlobalStateProperty).not.toHaveBeenCalled();
    expect(slider().value).toBe("2020");
  });

  it("a default added to a key that only carried a panel seed applies, and the slider moves", async () => {
    const seeded = doc([], { parameters: { year: { type: "range", min: 2000, max: 2030, step: 1 } } });
    const { renderer, map } = await loaded(seeded);
    // The browser seeds the slider at its midpoint (jsdom: 50, whatever the
    // bounds); the panel wrote that once, with provenance `seed`.
    const seed = Number(slider().value);
    expect(renderer.getState()).toEqual({ year: seed });
    expect(map.setGlobalStateProperty).toHaveBeenCalledWith("year", seed);

    await renderer.update(doc([], { ...seeded.options, state: { year: { default: 2005 } } }));
    expect(renderer.getState()).toEqual({ year: 2005 });
    expect(map.setGlobalStateProperty).toHaveBeenLastCalledWith("year", 2005);
    expect(slider().value).toBe("2005");
  });

  it("a key the next document drops leaves getState() and is listed under changed", async () => {
    const two = doc([], { state: { year: { default: 2010 }, mode: { default: "all" } } });
    const { renderer, events } = await loaded(two);
    renderer.setState({ mode: "some" });
    events.state.length = 0;
    await renderer.update(doc([], { state: { year: { default: 2010 } } }));
    expect(renderer.getState()).toEqual({ year: 2010 });
    expect(events.state).toEqual([{ values: { year: 2010 }, changed: ["mode"] }]);
  });

  it("a layer the reader hid stays hidden and unchecked across a recolour, and across a panel rebuild for a new toggleable layer", async () => {
    const { renderer, map } = await loaded(years());
    const [a] = toggles();
    a!.checked = false;
    a!.dispatchEvent(new Event("change"));
    expect(map.getLayoutProperty("a", "visibility")).toBe("none");

    await renderer.update(years({}, [circle("a", { label: "Points", paint: { "circle-color": "#00f" } })]));
    expect(map.getLayoutProperty("a", "visibility")).toBe("none");
    expect(toggles().map((t) => t.checked)).toEqual([false]);

    await renderer.update(years({}, [circle("a", { label: "Points", paint: { "circle-color": "#00f" } }), circle("b", { label: "More" })]));
    expect(map.getLayoutProperty("a", "visibility")).toBe("none");
    expect(toggles().map((t) => t.checked)).toEqual([false, true]);
  });

  it("a layer the reader hid stays hidden across a replacement forced by its source, and across a re-add after a host removed it", async () => {
    const { renderer, map } = await loaded(years());
    const [a] = toggles();
    a!.checked = false;
    a!.dispatchEvent(new Event("change"));
    expect(map.getLayoutProperty("a", "visibility")).toBe("none");

    // `cluster` has no setter: the source is rebuilt and the layer replaced from the document, whose `visible` is on.
    const clustered = circle("a", { label: "Points", source: { type: "geojson", data: EMPTY, cluster: true } });
    const replaced = await renderer.update(years({}, [clustered]));
    expect(replaced.summary?.replaced).toEqual(["a"]);
    expect(replaced.summary?.failures).toEqual([]);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), undefined);
    expect(map.getLayoutProperty("a", "visibility")).toBe("none");
    expect(toggles().map((t) => t.checked)).toEqual([false]);
    expect(renderer.getState()).toEqual({ year: 2010 });

    // A host takes the layer off the map; the next update puts it back (KTD1), still hidden.
    map.removeLayer("a");
    const readded = await renderer.update(years({}, [{ ...clustered, paint: { "circle-color": "#00f" } } as Layer]));
    expect(readded.summary?.added).toEqual(["a"]);
    expect(map.getLayoutProperty("a", "visibility")).toBe("none");
    expect(toggles().map((t) => t.checked)).toEqual([false]);

    // Checking the box again shows the replaced layer.
    const [again] = toggles();
    again!.checked = true;
    again!.dispatchEvent(new Event("change"));
    expect(map.getLayoutProperty("a", "visibility")).toBe("visible");
  });
});

describe("initialState, initialVisibility and writes before load", () => {
  it("a renderer constructed with initialState and initialVisibility applies them after the document defaults", async () => {
    const { renderer, map, events } = await loaded(years(), { initialState: { year: 2020, ghost: 1 }, initialVisibility: { a: false } });
    expect(stateCalls(map)).toEqual([["year", 2010], ["year", 2020]]);
    expect(renderer.getState()).toEqual({ year: 2020 });
    expect(map.getLayoutProperty("a", "visibility")).toBe("none");
    expect(toggles().map((t) => t.checked)).toEqual([false]);
    expect(slider().value).toBe("2020");
    expect(events.state).toEqual([{ values: { year: 2020 }, changed: ["year"] }]);
  });

  it("setState before the map loads is queued and applied once it loads, after the defaults", async () => {
    const renderer = new MapRenderer(container, config, [], YEAR);
    const map = renderer.getMap() as any;
    const events = listen(renderer);
    renderer.setState({ year: 2025 });
    expect(map.setGlobalStateProperty).not.toHaveBeenCalled();
    expect(() => renderer.setState({ nope: 1 })).toThrow(/nope/);

    const ready = new Promise<void>((resolve) => renderer.on("load", resolve));
    map.emit("load");
    await ready;
    expect(stateCalls(map)).toEqual([["year", 2010], ["year", 2025]]);
    expect(renderer.getState()).toEqual({ year: 2025 });
    expect(slider().value).toBe("2025");
    expect(events.state).toEqual([{ values: { year: 2025 }, changed: ["year"] }]);
  });
});
