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
import { layerSourceRefs as D } from "../fixtures/parity";

const sourceError = (errors: { path: string }[], path: string) => errors.find((e) => e.path === path);

describe("v1 named sources", () => {
  const doc = D.v1NamedTypo;

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
    const result = YAMLParser.safeParseMapBlock(D.definedNames);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("an inline source's id: names nothing: the error says so and how to share it", () => {
    const result = YAMLParser.safeParseMapBlock(D.inlineSourceId);
    expect(result.success).toBe(false);
    const message = sourceError(result.errors, "layers.1.source")!.message;
    expect(message).toContain("Layer \"clusters\" writes id: quakes on its own inline source");
    expect(message).toContain("move it under sources: as quakes:");
  });

  it("a layer's id used as a source name: the error says the source is inline", () => {
    const result = YAMLParser.safeParseMapBlock(D.layerIdAsSource);
    expect(result.success).toBe(false);
    expect(sourceError(result.errors, "layers.1.source")!.message).toContain(
      '"earthquakes" is a layer, and its source is written inline'
    );
  });

  it("no sources at all: the error says to add one", () => {
    const result = YAMLParser.safeParseMapBlock(D.noSources);
    expect(sourceError(result.errors, "layers.0.source")!.message).toContain(
      "This document defines no sources: add it under sources:."
    );
  });
});

describe("names a basemap may hold", () => {
  it("with a style URL: a raster layer, or a layer with source-layer:, may name a basemap source", () => {
    const result = YAMLParser.safeParseMapBlock(D.basemapNames);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("an inline style object: its sources are known, so anything else is an error", () => {
    const ok = YAMLParser.safeParseMapBlock(D.inlineStyleKnown);
    expect(ok.errors).toEqual([]);

    const typo = YAMLParser.safeParseMapBlock(D.inlineStyleTypo);
    expect(typo.success).toBe(false);
    const error = sourceError(typo.errors, "layers.0.source")!;
    expect(error.message).toContain('Did you mean "osm"?');
    expect(error.message).not.toContain("source-layer");
  });

  it("the Protomaps shorthand's one source is protomaps", () => {
    const ok = YAMLParser.safeParseMapBlock(D.protomapsSource);
    expect(ok.errors).toEqual([]);

    const other = YAMLParser.safeParseMapBlock(D.protomapsOtherSource);
    expect(other.success).toBe(false);
    expect(sourceError(other.errors, "layers.0.source")).toBeDefined();
  });
});

describe("v2 style.sources", () => {
  const v2 = (source: string) =>
    YAMLParser.safeParseMapBlock(D.v2(source));

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
    YAMLParser.safeParseScrollytellingBlock(D.story(source));

  it("a story's layer naming an undefined source is an error", () => {
    expect(story("quakes").errors).toEqual([]);
    const result = story("quake");
    expect(result.success).toBe(false);
    expect(sourceError(result.errors, "layers.0.source")).toMatchObject({ line: 14, suggestion: "quakes" });
  });
});

describe("multi-page root documents", () => {
  const root = D.root;

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
    const doc = D.rootOtherPageSource;
    const result = YAMLParser.safeParseAny(doc).result;
    expect(result.success).toBe(false);
    expect(sourceError(result.errors, "pages.1.blocks.0.layers.0.source")).toBeDefined();
  });
});
