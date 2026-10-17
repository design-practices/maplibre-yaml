/**
 * @file A story's map half: geo sugar (ml-ddg) and map-level keys (ml-t2x)
 *
 * @description
 * ml-ddg: `location:` / `region:` / `route:` sugar on a story layer's source
 * surfaced the raw "GeoJSON source requires url/data/prefetchedData" error,
 * on every scrollytelling entry path (standalone parse, value validation,
 * and a story nested in a `pages:` document).
 *
 * ml-t2x: a story's map was `config:` + `layers:` only; `sources:`,
 * `markers:`, `legend:`, `state:`/`parameters:` were unknown keys. The story
 * map is an `<ml-map>`, so it takes the whole map surface.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";

const STORY = (extra: string) => `type: scrollytelling
id: s
config:
  center: [138.7, 35.3]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
${extra}
chapters:
  - { id: a, title: A, center: [138.7, 35.3], zoom: 6 }
`;

const SUGAR_LAYER = `layers:
  - id: fuji
    type: circle
    source:
      type: geojson
      location: { coordinates: [138.7274, 35.3606], name: Fuji }`;

describe("geo sugar on story layer sources (ml-ddg)", () => {
  it("safeParseScrollytellingBlock expands it", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(STORY(SUGAR_LAYER));
    expect(result.errors).toEqual([]);
    const source = (result.data!.layers[0] as any).source;
    expect(source.location).toBeUndefined();
    expect(source.data).toMatchObject({
      type: "Feature",
      geometry: { type: "Point", coordinates: [138.7274, 35.3606] },
      properties: { name: "Fuji" },
    });
  });

  it("parseScrollytellingBlock expands it", () => {
    const story = YAMLParser.parseScrollytellingBlock(STORY(SUGAR_LAYER));
    expect((story.layers[0] as any).source.data.type).toBe("Feature");
  });

  it("safeParseScrollytellingBlockValue (an object) expands it, without line numbers", () => {
    const value = YAMLParser.parseScrollytellingBlock(STORY("")) as any;
    value.layers = [
      {
        id: "r",
        type: "line",
        source: { type: "geojson", route: { coordinates: [[0, 0], [1, 1]] } },
      },
    ];
    const result = YAMLParser.safeParseScrollytellingBlockValue(value);
    expect(result.errors).toEqual([]);
    expect((result.data!.layers[0] as any).source.data.geometry.type).toBe("LineString");
  });

  it("a story nested in a pages: document expands it too", () => {
    const result = YAMLParser.safeParse(`pages:
  - path: /
    title: Home
    blocks:
      - type: scrollytelling
        id: s
        config: { center: [0, 0], zoom: 2, mapStyle: "https://demotiles.maplibre.org/style.json" }
        layers:
          - id: fuji
            type: circle
            source:
              type: geojson
              location: { coordinates: [138.7274, 35.3606] }
        chapters:
          - { id: a, title: A, center: [0, 0], zoom: 3 }
`);
    expect(result.errors).toEqual([]);
    const block = (result.data as any).pages[0].blocks[0];
    expect(block.layers[0].source.data.geometry.type).toBe("Point");
  });

  it("a bad sugar value reports its own error at the sugar key", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(
      STORY(`layers:
  - id: bad
    type: circle
    source:
      type: geojson
      location: { coordinates: "not a position" }`)
    );
    expect(result.success).toBe(false);
    expect(result.errors[0]!.path).toContain("layers.0.source.location");
  });
});

describe("a story takes the map-level keys of a map document (ml-t2x)", () => {
  it("sources, markers, legend, state and parameters validate with no unknown-key warning", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(
      STORY(`sources:
  pts:
    type: geojson
    data: { type: FeatureCollection, features: [] }
layers:
  - { id: dots, type: circle, source: pts }
markers:
  - at: [138.7, 35.3]
    popup:
      - h3:
          - str: Fuji
legend:
  title: Key
  items:
    - { color: "#f00", label: Dots }
state:
  big: { default: false }
parameters:
  big: { label: Bigger dots, type: toggle }`)
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((w) => /Unknown key/.test(w.message))).toEqual([]);
    expect(result.data).toMatchObject({
      sources: { pts: { type: "geojson" } },
      markers: [{ at: [138.7, 35.3] }],
      legend: { title: "Key" },
    });
  });

  it("they are validated with the map schema (a bad marker is an error)", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(STORY(`markers:\n  - popup: no position`));
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path?.startsWith("markers.0"))).toBe(true);
  });

  it("a typo still gets a did-you-mean", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(STORY(`marker:\n  - at: [0, 0]`));
    expect(result.warnings.some((w) => /marker/.test(w.message) && /markers/.test(w.message))).toBe(true);
  });
});
