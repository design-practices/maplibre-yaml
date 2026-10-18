/**
 * MapRenderer tells its host WHICH part of the document an error belongs to
 * (ml-aot.14, ml-aot.15), so <ml-map> can show a basemap-style failure as a
 * card, a broken layer in the notice, and keep basemap noise off the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MapRenderer } from "../../src/renderer/map-renderer";

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn();
    public addControl = vi.fn();
    public removeControl = vi.fn();
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

const CONFIG = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/styles.json" };
const LAYERS: any[] = [
  { id: "cities", type: "circle", source: "cities", paint: { "circle-color": "#f00" } },
  {
    id: "inline",
    type: "circle",
    source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
];
const SOURCES: any = { cities: { type: "geojson", data: { type: "FeatureCollection", features: [] } } };

describe("MapRenderer error context", () => {
  let container: HTMLElement;
  let onError: ReturnType<typeof vi.fn>;
  let renderer: MapRenderer;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    onError = vi.fn();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderer = new MapRenderer(container, CONFIG, LAYERS, { onError }, SOURCES);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    document.body.innerHTML = "";
  });

  const map = () => renderer.getMap() as any;
  const fire = (error: unknown, extra: Record<string, unknown> = {}) =>
    map().emit("error", { error, ...extra });

  it("an error before the style has loaded is the style failing: fatal, with the URL", () => {
    const failure = Object.assign(new Error("AJAXError: Not Found (404): https://example.com/styles.json"), {
      status: 404,
    });
    fire(failure);
    expect(onError).toHaveBeenCalledWith(failure, true, {
      kind: "style",
      url: "https://example.com/styles.json",
    });
  });

  it("a worker that failed to start is not reported as a style failure", () => {
    fire(new Error("Worker failed to load. Check that the worker URL is correct."));
    expect(onError.mock.calls[0]![2]).toBeUndefined();
  });

  describe("after the style has loaded", () => {
    beforeEach(() => map().emit("style.load"));

    it("a MapLibre validation error on a document layer names the layer, non-fatal", () => {
      const error = new Error('layers.cities.paint.circle-color: color expected, "bleu" found');
      fire(error);
      expect(onError).toHaveBeenCalledWith(error, false, { kind: "layer", layerId: "cities" });
    });

    it("an error event from a document source names the source (inline sources included)", () => {
      fire(new Error("tiles failed"), { sourceId: "inline-source" });
      expect(onError.mock.calls[0]![2]).toEqual({ kind: "source", sourceId: "inline-source" });
    });

    it("a basemap tile 404 carries no context: not the document's problem", () => {
      fire(new Error("AJAXError: Not Found (404): https://tiles/1/2/3.pbf"), { sourceId: "openmaptiles", tile: {} });
      expect(onError).toHaveBeenCalledWith(expect.any(Error), false, undefined);
    });
  });

  it("a layer that cannot be added is reported against that layer, and the document still loads", async () => {
    const r = new MapRenderer(
      container,
      CONFIG,
      [{ id: "typo", type: "circle", source: "citeis" } as any, ...LAYERS],
      { onError },
      SOURCES
    );
    const m = r.getMap() as any;
    m.getSource = vi.fn((id: string) => (id === "cities" || id === "inline-source" ? {} : undefined));
    const loaded = vi.fn();
    r.on("load", loaded);
    m.emit("load");
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, fatal, context] = onError.mock.calls[0]!;
    expect(fatal).toBe(false);
    expect(context).toEqual({ kind: "layer", layerId: "typo" });
    expect((error as Error).message).toBe(
      'Source "citeis" doesn\'t exist. Did you mean "cities"? Declare it under sources:, or name a source from the basemap style.'
    );
  });
});
