/**
 * MapRenderer with a Protomaps basemap shorthand (0.9, ml-cnv.7): the map is
 * built without a style, given the generated one when the generator has
 * loaded, and a file that is not a Protomaps basemap gets a notice.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
    public ctorOptions: any;
    public setStyle = vi.fn();
    public addControl = vi.fn();
    public getSource = vi.fn();
    public container: HTMLElement;
    public canvas?: HTMLCanvasElement;
    constructor(options?: any) {
      this.ctorOptions = options;
      this.container = options.container;
    }
    getContainer() {
      return this.container;
    }
    getCanvas() {
      return (this.canvas ??= document.createElement("canvas"));
    }
    on(event: string, cb: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(cb);
    }
    off(event: string, cb: Function) {
      this.events.get(event)?.delete(cb);
    }
    emit(event: string, data?: any) {
      this.events.get(event)?.forEach((cb) => cb(data));
    }
    remove() {}
  }
  const AttributionControl = vi.fn(() => ({ type: "attribution" }));
  return { default: { Map: MockMap, AttributionControl }, Map: MockMap, AttributionControl };
});

const pmtiles = vi.hoisted(() => ({ metadata: vi.fn(async (): Promise<unknown> => ({ version: "4.13.0" })) }));
vi.mock("../../src/formats/pmtiles", async (load) => ({
  ...(await load<object>()),
  archiveMetadata: pmtiles.metadata,
}));

import { MapRenderer } from "../../src/renderer/map-renderer";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

function render(mapStyle: unknown, onError = vi.fn()) {
  const container = document.createElement("div");
  const wrapper = document.createElement("section");
  wrapper.setAttribute("lang", "fr");
  wrapper.appendChild(container);
  document.body.appendChild(wrapper);
  const renderer = new MapRenderer(container, { center: [-73.99, 40.7], zoom: 14, mapStyle } as never, [], {
    onError,
  });
  return { renderer, map: renderer.getMap() as any, onError };
}

describe("MapRenderer: a Protomaps basemap from a .pmtiles file", () => {
  it("builds the map without a style, then sets the generated one (file resolved against the page, labels in the page's language)", async () => {
    const { map } = render({ pmtiles: "data/nyc.pmtiles", flavor: "dark" });
    expect(map.ctorOptions.style).toBeUndefined();
    await until(() => map.setStyle.mock.calls.length > 0);
    const style = map.setStyle.mock.calls[0][0];
    expect(style.sources.protomaps.url).toBe(`pmtiles://${new URL("data/nyc.pmtiles", document.baseURI).href}`);
    expect(style.sprite).toMatch(/sprites\/v4\/dark$/);
    const locality = style.layers.find((l: { id: string }) => l.id === "places_locality");
    expect(JSON.stringify(locality.layout["text-field"])).toContain("name:fr");
  });

  it("a style URL or object is still handed to MapLibre at construction", () => {
    const { map } = render("https://example.org/style.json");
    expect(map.ctorOptions.style).toBe("https://example.org/style.json");
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it("a file without the basemap's layers gets the map's notice (once)", async () => {
    const { map, onError } = render({ pmtiles: "https://h/districts.pmtiles" });
    map.getSource.mockReturnValue({ vectorLayerIds: ["districts"], url: "pmtiles://https://h/districts.pmtiles" });
    map.emit("sourcedata", { sourceId: "other", sourceDataType: "metadata" });
    map.emit("sourcedata", { sourceId: "protomaps", sourceDataType: "metadata" });
    map.emit("sourcedata", { sourceId: "protomaps", sourceDataType: "metadata" });
    // MapLibre's per-layer complaints about the missing tile layers stay off the page.
    map.emit("error", {
      error: new Error('Source layer "earth" does not exist on source "protomaps" as specified by style layer "earth".'),
    });
    const notices = onError.mock.calls.filter((c) => c[2]?.kind === "basemap");
    expect(onError.mock.calls.filter((c) => /Source layer/.test(c[0].message))).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0][0].message).toContain("doesn't look like a Protomaps basemap");
    expect(notices[0][1]).toBe(false);
  });

  it("a basemap file that fails to load is reported as the basemap's, not a document source", () => {
    const { map, onError } = render({ pmtiles: "https://h/missing.pmtiles" });
    map.emit("style.load");
    map.emit("error", {
      sourceId: "protomaps",
      error: new Error("`https://h/missing.pmtiles` didn't load (404 Not Found)."),
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), false, {
      kind: "source",
      sourceId: "protomaps",
      basemap: true,
    });
  });

  it("a Protomaps file from the older tile schema (v3) gets a notice to cut a new extract (ml-aot.126)", async () => {
    pmtiles.metadata.mockResolvedValueOnce({
      version: "3.7.1",
      vector_layers: [{ id: "roads", fields: { "pmap:kind": "String", "pmap:min_zoom": "Number" } }],
    });
    const { map, onError } = render({ pmtiles: "https://h/firenze.pmtiles" });
    map.getSource.mockReturnValue({
      vectorLayerIds: ["earth", "water", "roads", "places", "buildings"],
      url: "pmtiles://https://h/firenze.pmtiles",
    });
    map.emit("sourcedata", { sourceId: "protomaps", sourceDataType: "metadata" });
    await until(() => onError.mock.calls.length > 0);
    const notices = onError.mock.calls.filter((c) => c[2]?.kind === "basemap");
    expect(notices).toHaveLength(1);
    expect(notices[0][0].message).toContain(
      "is a Protomaps basemap built with an older tile schema (version 3.7.1), so only land and water draw"
    );
    expect(pmtiles.metadata).toHaveBeenCalledWith("pmtiles://https://h/firenze.pmtiles");
  });

  it("a current one says nothing", async () => {
    const { map, onError } = render({ pmtiles: "https://h/nyc.pmtiles" });
    map.getSource.mockReturnValue({ vectorLayerIds: ["earth", "water", "roads", "places"], url: "pmtiles://https://h/nyc.pmtiles" });
    map.emit("sourcedata", { sourceId: "protomaps", sourceDataType: "metadata" });
    await new Promise((r) => setTimeout(r, 30));
    expect(onError.mock.calls.filter((c) => c[2]?.kind === "basemap")).toEqual([]);
  });
});
