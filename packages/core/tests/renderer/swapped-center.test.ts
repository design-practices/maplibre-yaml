/**
 * `center: [lat, lng]` (ml-aot.65): written the way many web maps show
 * coordinates, latitude first, the map opens somewhere empty (the starter's
 * NYC data ended up 11,000 km away) with no hint. Once the document's data
 * has loaded, a center far from it whose swapped pair lands on it is
 * reported through onError with context `{ kind: "center" }`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MapRenderer } from "../../src/renderer/map-renderer";
import { describeSwappedCenter } from "../../src/components/student-messages";

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn(() => ({}));
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

const point = (lng: number, lat: number) => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Point", coordinates: [lng, lat] },
});
const NYC = {
  type: "geojson",
  data: { type: "FeatureCollection", features: [point(-73.97, 40.78), point(-73.99, 40.71), point(-73.96, 40.66)] },
};
const layers: any[] = [{ id: "places", type: "circle", source: NYC }];
const style = "https://x/style.json";

async function load(config: Record<string, unknown>) {
  const onError = vi.fn();
  const r = new MapRenderer(document.createElement("div"), { zoom: 11, mapStyle: style, ...config } as any, layers, { onError }, {});
  const loaded = vi.fn();
  r.on("load", loaded);
  (r.getMap() as any).emit("load");
  await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
  return onError.mock.calls.filter((c) => c[2]?.kind === "center");
}

describe("a center written [lat, lng] (ml-aot.65)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("is reported once, with the swapped pair", async () => {
    const calls = await load({ center: [40.75, -73.98] });
    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).toEqual({ kind: "center", center: [40.75, -73.98], swapped: [-73.98, 40.75] });
    expect(calls[0]![1]).toBe(false);
  });

  it("a center on or near the data, or a map framed by fitTo/bounds, is fine", async () => {
    expect(await load({ center: [-73.98, 40.75] })).toEqual([]);
    expect(await load({ center: [-74.5, 41.2] })).toEqual([]);
    expect(await load({ center: [40.75, -73.98], bounds: [-74.1, 40.6, -73.9, 40.9] })).toEqual([]);
  });

  it("words it for the page", () => {
    expect(describeSwappedCenter([40.75, -73.98], [-73.98, 40.75])).toBe(
      "`center` is [40.75, -73.98], but this map's data is around [-73.98, 40.75]. Coordinates are [longitude, latitude]: did you mean center: [-73.98, 40.75]?"
    );
  });
});
