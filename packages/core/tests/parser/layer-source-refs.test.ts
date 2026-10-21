/**
 * A layer whose `source:` names a source that doesn't exist fails validation
 * at the layer's `source:` line, with a did-you-mean (ml-aot.133) — in v1
 * maps, v2 `style.sources`, stories and multi-page root documents, through
 * every entry point (`mlym validate` = safeParseAny, `<ml-map>` =
 * safeParseMapBlock / safeParseMapBlockValue, the throwing parse()).
 *
 * The exception is a name a basemap style URL might hold: a raster layer, or
 * one with `source-layer:`. There only a near miss warns, as before.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";

const EMPTY = "{ type: FeatureCollection, features: [] }";

const map = (body: string, mapStyle = "https://example.com/style.json") =>
  `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${mapStyle}
${body}`;

const sourceError = (errors: { path: string }[], path: string) => errors.find((e) => e.path === path);

describe("v1 named sources", () => {
  const doc = map(`sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  - id: dots
    type: circle
    source: quake
`);

  it("mlym validate (safeParseAny): an error at the source: line, with a did-you-mean", () => {
    const { blockType, result } = YAMLParser.safeParseAny(doc);
    expect(blockType).toBe("map");
    expect(result.success).toBe(false);
    const error = sourceError(result.errors, "layers.0.source");
    expect(error).toMatchObject({ line: 14, column: 13, suggestion: "quakes" });
    expect(error!.message).toContain('Layer "dots" uses source "quake", which this document doesn\'t define.');
    expect(error!.message).toContain('Did you mean "quakes"?');
  });

  it("<ml-map> validation, from YAML and from a config object", () => {
    expect(YAMLParser.safeParseMapBlock(doc).success).toBe(false);
    const value = {
      type: "map",
      id: "m",
      config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
      sources: { quakes: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [{ id: "dots", type: "circle", source: "quake" }],
    };
    const result = YAMLParser.safeParseMapBlockValue(value);
    expect(result.success).toBe(false);
    expect(sourceError(result.errors, "layers.0.source")?.message).toContain('Did you mean "quakes"?');
  });

  it("the throwing parseMapBlock throws it too", () => {
    expect(() => YAMLParser.parseMapBlock(doc)).toThrow(/uses source "quake"/);
  });

  it("a defined name, an inline source's generated name and a background layer are fine", () => {
    const result = YAMLParser.safeParseMapBlock(
      map(`sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  - id: bg
    type: background
    paint: { background-color: "#fff" }
  - id: dots
    type: circle
    source: quakes
  - id: inline
    type: circle
    source: { type: geojson, data: ${EMPTY} }
  - id: halo
    type: circle
    source: inline-source
`)
    );
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("an inline source's id: names nothing: the error says so and how to share it", () => {
    const result = YAMLParser.safeParseMapBlock(
      map(`layers:
  - id: clusters
    type: circle
    source:
      id: quakes
      type: geojson
      data: ${EMPTY}
  - id: counts
    type: symbol
    source: quakes
`)
    );
    expect(result.success).toBe(false);
    const message = sourceError(result.errors, "layers.1.source")!.message;
    expect(message).toContain("Layer \"clusters\" writes id: quakes on its own inline source");
    expect(message).toContain("move it under sources: as quakes:");
  });

  it("a layer's id used as a source name: the error says the source is inline", () => {
    const result = YAMLParser.safeParseMapBlock(
      map(`layers:
  - id: earthquakes
    type: circle
    source: { type: geojson, data: ${EMPTY} }
  - id: counts
    type: symbol
    source: earthquakes
`)
    );
    expect(result.success).toBe(false);
    expect(sourceError(result.errors, "layers.1.source")!.message).toContain(
      '"earthquakes" is a layer, and its source is written inline'
    );
  });

  it("no sources at all: the error says to add one", () => {
    const result = YAMLParser.safeParseMapBlock(
      map(`layers:
  - id: dots
    type: circle
    source: quakes
`)
    );
    expect(sourceError(result.errors, "layers.0.source")!.message).toContain(
      "This document defines no sources: add it under sources:."
    );
  });
});

describe("names a basemap may hold", () => {
  it("with a style URL: a raster layer, or a layer with source-layer:, may name a basemap source", () => {
    const result = YAMLParser.safeParseMapBlock(
      map(`layers:
  - id: buildings
    type: fill-extrusion
    source: openmaptiles
    source-layer: building
  - id: hillshade
    type: hillshade
    source: terrain
`)
    );
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("an inline style object: its sources are known, so anything else is an error", () => {
    const style = `{ version: 8, sources: { osm: { type: raster, tiles: ["https://t/{z}/{x}/{y}.png"] } }, layers: [] }`;
    const ok = YAMLParser.safeParseMapBlock(
      map(`layers:
  - id: base
    type: raster
    source: osm
`, style)
    );
    expect(ok.errors).toEqual([]);

    const typo = YAMLParser.safeParseMapBlock(
      map(`layers:
  - id: base
    type: raster
    source: osn
`, style)
    );
    expect(typo.success).toBe(false);
    const error = sourceError(typo.errors, "layers.0.source")!;
    expect(error.message).toContain('Did you mean "osm"?');
    expect(error.message).not.toContain("source-layer");
  });

  it("the Protomaps shorthand's one source is protomaps", () => {
    const ok = YAMLParser.safeParseMapBlock(
      map(`layers:
  - id: water
    type: fill
    source: protomaps
    source-layer: water
`, "data/basemap.pmtiles")
    );
    expect(ok.errors).toEqual([]);

    const other = YAMLParser.safeParseMapBlock(
      map(`layers:
  - id: water
    type: fill
    source: openmaptiles
    source-layer: water
`, "data/basemap.pmtiles")
    );
    expect(other.success).toBe(false);
    expect(sourceError(other.errors, "layers.0.source")).toBeDefined();
  });
});

describe("v2 style.sources", () => {
  const v2 = (source: string) =>
    YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [0, 0]
  zoom: 2
  sources:
    quakes:
      type: geojson
      data: ${EMPTY}
  layers:
    - id: dots
      type: circle
      source: ${source}
`);

  it("a defined name is fine", () => {
    expect(v2("quakes").errors).toEqual([]);
  });

  it("an undefined one is an error that points at style.sources:", () => {
    const result = v2("quaks");
    expect(result.success).toBe(false);
    const error = sourceError(result.errors, "style.layers.0.source")!;
    expect(error).toMatchObject({ line: 15, suggestion: "quakes" });
    expect(error.message).toContain('Did you mean "quakes"?');
  });
});

describe("stories", () => {
  const story = (source: string) =>
    YAMLParser.safeParseScrollytellingBlock(`type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  - id: dots
    type: circle
    source: ${source}
chapters:
  - id: a
    title: A
    center: [0, 0]
    zoom: 2
    layers: { show: [dots] }
`);

  it("a story's layer naming an undefined source is an error", () => {
    expect(story("quakes").errors).toEqual([]);
    const result = story("quake");
    expect(result.success).toBe(false);
    expect(sourceError(result.errors, "layers.0.source")).toMatchObject({ line: 14, suggestion: "quakes" });
  });
});

describe("multi-page root documents", () => {
  const root = (blockLayerSource: string, recordLayerSource = "quakes") => `config:
  defaultMapStyle: https://example.com/style.json
sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  shared:
    id: shared
    type: circle
    source: ${recordLayerSource}
pages:
  - path: /
    title: Home
    blocks:
      - type: map
        id: a
        config: { center: [0, 0], zoom: 2 }
        sources:
          parks:
            type: geojson
            data: ${EMPTY}
        layers:
          - id: dots
            type: circle
            source: ${blockLayerSource}
          - $ref: "#/layers/shared"
`;

  it("a block's layer may use a root source or its own", () => {
    expect(YAMLParser.safeParseAny(root("quakes")).result.errors).toEqual([]);
    expect(YAMLParser.safeParseAny(root("parks")).result.errors).toEqual([]);
  });

  it("a root layers: entry may use a source a block defines (it lands in that block by $ref)", () => {
    expect(YAMLParser.safeParseAny(root("quakes", "parks")).result.errors).toEqual([]);
  });

  it("an undefined name is an error, in a block and in the layers: record", () => {
    const block = YAMLParser.safeParseAny(root("quaks")).result;
    expect(block.success).toBe(false);
    expect(sourceError(block.errors, "pages.0.blocks.0.layers.0.source")).toMatchObject({ suggestion: "quakes" });

    const record = YAMLParser.safeParseAny(root("quakes", "prks")).result;
    expect(record.success).toBe(false);
    expect(sourceError(record.errors, "layers.shared.source")).toMatchObject({ suggestion: "parks" });

    expect(() => YAMLParser.parse(root("quaks"))).toThrow(/uses source "quaks"/);
  });

  it("a source defined only in another page's block is not in scope", () => {
    const doc = root("parks").replace(
      "          - $ref: \"#/layers/shared\"\n",
      `          - $ref: "#/layers/shared"
  - path: /other
    title: Other
    blocks:
      - type: map
        id: b
        config: { center: [0, 0], zoom: 2 }
        layers:
          - id: more
            type: circle
            source: parks
`
    );
    const result = YAMLParser.safeParseAny(doc).result;
    expect(result.success).toBe(false);
    expect(sourceError(result.errors, "pages.1.blocks.0.layers.0.source")).toBeDefined();
  });
});
