/**
 * A label layer with no `text-font` (ml-aot.53). MapLibre's default stack
 * ("Open Sans Regular,Arial Unicode MS Regular") does not exist on most
 * basemaps (OpenFreeMap has Noto Sans), so every label logged glyph 404s and
 * one warning per character. The renderer now borrows the basemap's own font
 * stack, and warns once with the fix when the basemap names none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MapRenderer } from "../../src/renderer/map-renderer";

let styleLayers: any[] = [];

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn();
    public addControl = vi.fn();
    public removeControl = vi.fn();
    getStyle() {
      return { version: 8, sources: {}, layers: styleLayers };
    }
    getCanvas() {
      return { style: { cursor: "" } };
    }
    on(event: string, callback: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(callback);
    }
    off(event: string, callback: Function) {
      this.events.get(event)?.delete(callback);
    }
    emit(event: string, data?: any) {
      this.events.get(event)?.forEach((cb) => cb(data));
    }
    remove() {}
  }
  const ctrl = vi.fn(() => ({}));
  const api = {
    Map: MockMap,
    NavigationControl: ctrl,
    GeolocateControl: ctrl,
    ScaleControl: ctrl,
    FullscreenControl: ctrl,
    AttributionControl: ctrl,
    Popup: vi.fn(),
  };
  return { default: api, ...api };
});

const CONFIG = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://x/style.json" };
const inline = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
const labels = (layout: Record<string, unknown>) => ({ id: "names", type: "symbol", source: inline, layout });

describe("label layers without text-font (ml-aot.53)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let renderer: MapRenderer;
  let added: any[];

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderer = new MapRenderer(document.createElement("div"), CONFIG, [], {}, {});
    added = [];
    vi.spyOn((renderer as any).layerManager, "addLayer").mockImplementation(async (l: any) => {
      added.push(l);
    });
  });

  afterEach(() => warn.mockRestore());

  it("borrows the basemap's Regular stack, not its first (ml-aot.61: Liberty starts with an italic water label)", async () => {
    styleLayers = [
      { id: "water", type: "fill" },
      { id: "waterway_line_label", type: "symbol", layout: { "text-font": ["Noto Sans Italic"], "text-field": "{name}" } },
      { id: "water_name", type: "symbol", layout: { "text-font": ["Noto Sans Italic"] } },
      { id: "road", type: "symbol", layout: { "text-font": ["Noto Sans Regular"] } },
      { id: "place", type: "symbol", layout: { "text-font": ["Noto Sans Bold"] } },
    ];
    await renderer.addLayer(labels({ "text-field": ["get", "name"] }) as any);
    expect(added[0].layout["text-font"]).toEqual(["Noto Sans Regular"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("with no Regular stack, borrows the stack the basemap uses most", async () => {
    styleLayers = [
      { id: "a", type: "symbol", layout: { "text-font": ["Open Sans Italic"] } },
      { id: "b", type: "symbol", layout: { "text-font": ["Open Sans Semibold"] } },
      { id: "c", type: "symbol", layout: { "text-font": ["Open Sans Semibold"] } },
    ];
    await renderer.addLayer(labels({ "text-field": "x" }) as any);
    expect(added[0].layout["text-font"]).toEqual(["Open Sans Semibold"]);
  });

  it("reads a literal-wrapped stack, and leaves an authored text-font alone", async () => {
    styleLayers = [{ id: "poi", type: "symbol", layout: { "text-font": ["literal", ["Noto Sans Bold"]] } }];
    await renderer.addLayer(labels({ "text-field": "x" }) as any);
    await renderer.addLayer({ ...labels({ "text-field": "x", "text-font": ["Mine"] }), id: "own" } as any);
    expect(added[0].layout["text-font"]).toEqual(["Noto Sans Bold"]);
    expect(added[1].layout["text-font"]).toEqual(["Mine"]);
  });

  it("an icon-only symbol layer is untouched", async () => {
    styleLayers = [{ id: "poi", type: "symbol", layout: { "text-font": ["Noto Sans Regular"] } }];
    await renderer.addLayer(labels({ "icon-image": "pin" }) as any);
    expect(added[0].layout["text-font"]).toBeUndefined();
  });

  it("when the basemap names no font, warns once with the fix", async () => {
    styleLayers = [{ id: "bg", type: "background" }];
    await renderer.addLayer(labels({ "text-field": "x" }) as any);
    await renderer.addLayer({ ...labels({ "text-field": "y" }), id: "more" } as any);
    expect(added[0].layout["text-font"]).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('layer "names" shows text but has no text-font');
    expect(String(warn.mock.calls[0]![0])).toContain("text-font:");
  });
});
