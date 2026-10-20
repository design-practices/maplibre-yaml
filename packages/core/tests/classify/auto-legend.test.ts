/**
 * @file Automatic legend for classified maps (0.9 maintainer decision): a
 * map or story with a `classify:` layer and NO `legend:` block gets a legend
 * by the normal rules; `legend: false` turns it off; an authored `legend:`
 * block behaves as before.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events: Map<string, Set<Function>> = new Map();
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn();
    public setLayoutProperty = vi.fn();
    public setPaintProperty = vi.fn();
    public addControl = vi.fn();
    public removeControl = vi.fn();
    getCanvas() {
      return { style: { cursor: "" } };
    }
    on(event: string, callback: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(callback);
    }
    emit(event: string, data?: any) {
      this.events.get(event)?.forEach((cb) => cb(data));
    }
    off(event: string, callback: Function) {
      this.events.get(event)?.delete(callback);
    }
    remove() {}
  }
  const ctor = () => vi.fn(() => ({}));
  const mod = {
    Map: MockMap,
    NavigationControl: ctor(),
    GeolocateControl: ctor(),
    ScaleControl: ctor(),
    FullscreenControl: ctor(),
    AttributionControl: ctor(),
    Popup: ctor(),
  };
  return { default: mod, ...mod };
});

import { MapRenderer } from "../../src/renderer/map-renderer";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import { denormalizeConfig, denormalizeLayers, denormalizeOptions, denormalizeSources } from "../../src/model";
import { projectStyle } from "../../src/emitter/project";
import { storyMapDocument } from "../../src/scrollytelling";
import { storyLegendConfig } from "../../src/scrollytelling/story-legend";

const DATA = JSON.stringify({
  type: "FeatureCollection",
  features: [3, 12, null].map((v) => ({ type: "Feature", properties: { v }, geometry: { type: "Point", coordinates: [0, 0] } })),
});

function mapDoc(extra = "", classify = "classify: { field: v, breaks: [10], colors: [red, blue] }") {
  return `type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" }
${extra}
sources:
  pts: { type: geojson, data: ${DATA} }
layers:
  - id: a
    type: circle
    source: pts
    label: Value
    ${classify}
`;
}

function render(yaml: string): HTMLElement {
  const parsed = YAMLParser.safeParseMapBlock(yaml);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));
  const model = toModel(parsed.data as never);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const renderer = new MapRenderer(
    container,
    denormalizeConfig(model),
    denormalizeLayers(model),
    denormalizeOptions(model),
    denormalizeSources(model)
  );
  (renderer.getMap() as any).emit("load");
  return container;
}

describe("plain map", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("a classified layer and no legend: block → a legend, by the normal rules", () => {
    const container = render(mapDoc());
    const legend = container.querySelector(".ml-map-chrome-top-left .ml-map-legend");
    expect(legend).not.toBeNull();
    expect(legend!.querySelector("summary")!.textContent).toBe("Legend");
    expect(legend!.querySelector("details")!.open).toBe(true);
    const lines = [...legend!.querySelectorAll(".legend-group-heading, .legend-label")].map((n) => n.textContent);
    expect(lines).toEqual(["Value", "3–10", "10–12", "No data"]);
  });

  it("legend: false turns it off", () => {
    const container = render(mapDoc("legend: false"));
    expect(container.querySelector(".ml-map-legend")).toBeNull();
  });

  it("an authored legend: block behaves as before", () => {
    const container = render(mapDoc("legend: { position: bottom-right, title: Mine }"));
    const legend = container.querySelector(".ml-map-chrome-bottom-right .ml-map-legend");
    // The toggle always reads "Legend"; the author's title heads the panel.
    expect(legend!.querySelector("summary")!.textContent).toBe("Legend");
    expect(legend!.querySelector(".legend-heading")!.textContent).toBe("Mine");
  });

  it("no classified layer and no legend: block → no legend (unchanged)", () => {
    const container = render(mapDoc("", "paint: { circle-color: red }"));
    expect(container.querySelector(".ml-map-legend")).toBeNull();
  });
});

describe("fetched data handed over by the fitTo prefetch (#160)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("computes the breaks from prefetchedData before the layer is added (first frame classified)", async () => {
    const parsed = YAMLParser.safeParseMapBlock(`type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" }
sources:
  pts: { type: geojson, url: /pts.geojson }
layers:
  - id: a
    type: circle
    source: pts
    classify: { field: v, method: quantile, classes: 2, colors: [red, blue] }
`);
    const model = toModel(parsed.data as never);
    // What <ml-map> does when the prefetch landed in time.
    const sources = denormalizeSources(model)!;
    const withData = {
      ...sources,
      pts: { ...sources["pts"], prefetchedData: JSON.parse(DATA) },
    } as never;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new MapRenderer(
      container,
      denormalizeConfig(model),
      denormalizeLayers(model),
      denormalizeOptions(model),
      withData
    );
    const map = renderer.getMap() as any;
    const added = new Set<string>();
    map.addSource = vi.fn((id: string) => added.add(id));
    map.getSource = vi.fn((id: string) => (added.has(id) ? { setData: vi.fn() } : undefined));
    map.emit("load");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const layer = map.addLayer.mock.calls.map((c: unknown[]) => c[0]).find((l: any) => l.id === "a");
    expect(layer.paint["circle-color"][0]).toBe("let");
    expect(JSON.stringify(layer.paint["circle-color"])).toContain(
      '["step",["to-number",["var","value"]],"red",12,"blue"]'
    );
  });
});

describe("legend: false in every position", () => {
  it("validates in a v1 map, a v2 map's runtime, and a story", () => {
    expect(YAMLParser.safeParseMapBlock(mapDoc("legend: false")).errors).toEqual([]);
    const v2 = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style: { center: [0, 0], zoom: 2, sources: {}, layers: [] }
runtime: { legend: false }
`);
    expect(v2.errors).toEqual([]);
    const story = YAMLParser.safeParseScrollytellingBlock(`type: scrollytelling
id: s
config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" }
legend: false
chapters: [{ id: a, title: A, center: [0, 0], zoom: 2 }]
`);
    expect(story.errors).toEqual([]);
  });

  it("legend: false exports with nothing to report", () => {
    const parsed = YAMLParser.safeParseMapBlock(mapDoc("legend: false"));
    const { warnings } = projectStyle(toModel(parsed.data as never));
    expect(warnings.filter((w) => w.path === "legend")).toEqual([]);
  });
});

describe("stories", () => {
  const story = (legend?: unknown, classify = true) =>
    ({
      type: "scrollytelling",
      id: "s",
      config: { center: [0, 0], zoom: 2 },
      ...(legend !== undefined ? { legend } : {}),
      layers: [
        {
          id: "a",
          type: "fill",
          source: "x",
          ...(classify ? { classify: { field: "v", breaks: [1] } } : { paint: { "fill-color": "red" } }),
        },
      ],
      chapters: [],
    }) as never;

  it("a classified story without legend: pins an automatic legend", () => {
    expect(storyLegendConfig(story())).toEqual({});
  });

  it("legend: false — none; an authored legend: as written; no classify — none", () => {
    expect(storyLegendConfig(story(false))).toBeUndefined();
    expect(storyLegendConfig(story({ title: "T" }))).toEqual({ title: "T" });
    expect(storyLegendConfig(story(undefined, false))).toBeUndefined();
  });

  it("the story's own map never builds a second legend under the cards", () => {
    expect((storyMapDocument(story()) as Record<string, unknown>)["legend"]).toBe(false);
  });
});
