/**
 * A `$ref` that resolves nowhere fails validation at the `$ref` line, with a
 * did-you-mean (ml-aot.147) — the `$ref` twin of ml-aot.133's check for a
 * bare `source:` name, in the same document kinds: v1 maps, stories and
 * multi-page root documents, through every entry point (`mlym validate` =
 * safeParseAny, `<ml-map>` = safeParseMapBlock / safeParseMapBlockValue, the
 * throwing parse()).
 *
 * Before 0.9.1 a story's `source: { $ref: "#/sources/quake" }` passed
 * `mlym validate` while the story's `<ml-map>` showed "Source reference not
 * found"; a map or root document failed, but with no line, and only once
 * every other error was fixed. The message is the runtime's own, so the CLI
 * and the page say the same thing.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";
import { storyMapDocument } from "../../src/scrollytelling/engine";
import type { ScrollytellingBlock } from "../../src/schemas/scrollytelling.schema";

const EMPTY = "{ type: FeatureCollection, features: [] }";
const NOT_FOUND = 'Source reference not found: #/sources/quake. Did you mean "#/sources/quakes"? Defined sources: quakes.';

const map = (layers: string) => `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
${layers}`;

const dots = (ref: string) => `  - id: dots
    type: circle
    source:
      $ref: "${ref}"
`;

const errorAt = (errors: { path: string }[], path: string) => errors.find((e) => e.path === path);

describe("v1 maps", () => {
  const doc = map(dots("#/sources/quake"));

  it("mlym validate (safeParseAny): an error at the $ref line, with a did-you-mean", () => {
    const { blockType, result } = YAMLParser.safeParseAny(doc);
    expect(blockType).toBe("map");
    expect(result.success).toBe(false);
    expect(errorAt(result.errors, "layers.0.source.$ref")).toMatchObject({
      message: NOT_FOUND,
      line: 15,
      column: 13,
      suggestion: "#/sources/quakes",
    });
  });

  it("<ml-map> validation, from YAML and from a config object", () => {
    expect(errorAt(YAMLParser.safeParseMapBlock(doc).errors, "layers.0.source.$ref")?.message).toBe(NOT_FOUND);
    const result = YAMLParser.safeParseMapBlockValue({
      type: "map",
      id: "m",
      config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
      sources: { quakes: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [{ id: "dots", type: "circle", source: { $ref: "#/sources/quake" } }],
    });
    expect(result.success).toBe(false);
    expect(errorAt(result.errors, "layers.0.source.$ref")?.message).toBe(NOT_FOUND);
  });

  it("the throwing parseMapBlock throws it too", () => {
    expect(() => YAMLParser.parseMapBlock(doc)).toThrow(/Source reference not found: #\/sources\/quake\./);
  });

  it("is reported beside another error, not only once the rest of the document is valid", () => {
    const result = YAMLParser.safeParseMapBlock(doc.replace("zoom: 2", "zoom: lots"));
    expect(result.success).toBe(false);
    expect(errorAt(result.errors, "config.zoom")).toBeDefined();
    expect(errorAt(result.errors, "layers.0.source.$ref")?.message).toBe(NOT_FOUND);
  });

  it("a $ref to a defined source is fine", () => {
    const result = YAMLParser.safeParseMapBlock(map(dots("#/sources/quakes")));
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("a source $ref that points at a layer, or isn't a reference, is an error", () => {
    const layerRef = YAMLParser.safeParseMapBlock(map(dots("#/layers/quakes")));
    expect(errorAt(layerRef.errors, "layers.0.source.$ref")?.message).toMatch(
      /source: \$ref must point at a source \(#\/sources\/name\)/
    );
    const bad = YAMLParser.safeParseMapBlock(map(dots("sources/quakes")));
    expect(errorAt(bad.errors, "layers.0.source.$ref")?.message).toMatch(/^Invalid reference format: sources\/quakes\./);
  });

  it("a layers: entry $ref: a standalone map has no layers: record to point into", () => {
    const result = YAMLParser.safeParseMapBlock(map(`  - $ref: "#/layers/quakes"\n`));
    expect(result.success).toBe(false);
    const error = errorAt(result.errors, "layers.0.$ref");
    expect(error).toMatchObject({ line: 12 });
    expect(error!.message).toContain("Layer reference not found: #/layers/quakes.");
    expect(error!.message).toContain("only a multi-page (pages:) document has");
  });
});

describe("stories", () => {
  const story = (layers: string) => `type: scrollytelling
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
${layers}chapters:
  - id: a
    title: A
    center: [0, 0]
    zoom: 2
`;

  it("a story's $ref to a missing source is an error at its line (it passed before 0.9.1)", () => {
    const { blockType, result } = YAMLParser.safeParseAny(story(dots("#/sources/quake")));
    expect(blockType).toBe("scrollytelling");
    expect(result.success).toBe(false);
    expect(errorAt(result.errors, "layers.0.source.$ref")).toMatchObject({
      message: NOT_FOUND,
      line: 15,
      suggestion: "#/sources/quakes",
    });
  });

  it("agrees with the story's <ml-map>: same verdict, same words", () => {
    for (const ref of ["#/sources/quakes", "#/sources/quake", "#/layers/quakes"]) {
      const yaml = story(dots(ref));
      const validated = YAMLParser.safeParseScrollytellingBlock(yaml);
      // What <ml-scrollytelling> hands its <ml-map> (it validates the story
      // with refs unresolved, then the map resolves them).
      const raw = YAMLParser.safeParseScrollytellingBlock(story(dots("#/sources/quakes")));
      const asStory = { ...(raw.data as ScrollytellingBlock) };
      (asStory.layers[0] as { source: unknown }).source = { $ref: ref };
      const onPage = YAMLParser.safeParseMapBlockValue(storyMapDocument(asStory));
      expect(validated.success, ref).toBe(onPage.success);
      if (ref === "#/sources/quake") {
        expect(validated.errors[0]!.message).toBe(onPage.errors[0]!.message);
      }
    }
  });

  it("a story's layers: entry $ref is an error (the story's map has no layers: record)", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(story(`  - $ref: "#/layers/dots"\n`));
    expect(result.success).toBe(false);
    expect(errorAt(result.errors, "layers.0.$ref")?.message).toContain("Layer reference not found: #/layers/dots.");
  });
});

describe("multi-page root documents", () => {
  const root = (blockRef: string, recordRef = "#/sources/quakes") => `config:
  defaultMapStyle: https://example.com/style.json
sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  shared:
    id: shared
    type: circle
    source: { $ref: "${recordRef}" }
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
            source: { $ref: "${blockRef}" }
          - $ref: "#/layers/shared"
`;

  it("a root source by $ref is fine, in a block and in the layers: record", () => {
    const result = YAMLParser.safeParseAny(root("#/sources/quakes")).result;
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("a missing one is an error at its line, in a block and in the layers: record", () => {
    const block = YAMLParser.safeParseAny(root("#/sources/quake")).result;
    expect(block.success).toBe(false);
    expect(errorAt(block.errors, "pages.0.blocks.0.layers.0.source.$ref")).toMatchObject({
      message: NOT_FOUND,
      line: 26,
      suggestion: "#/sources/quakes",
    });

    const record = YAMLParser.safeParseAny(root("#/sources/quakes", "#/sources/quake")).result;
    expect(record.success).toBe(false);
    expect(errorAt(record.errors, "layers.shared.source.$ref")).toMatchObject({ message: NOT_FOUND, line: 11 });

    expect(() => YAMLParser.parse(root("#/sources/quake"))).toThrow(/Source reference not found: #\/sources\/quake\./);
  });

  it("a $ref to the block's own source: a $ref only looks at the root sources:", () => {
    const result = YAMLParser.safeParseAny(root("#/sources/parks")).result;
    expect(result.success).toBe(false);
    const message = errorAt(result.errors, "pages.0.blocks.0.layers.0.source.$ref")!.message;
    expect(message).toContain("Source reference not found: #/sources/parks.");
    expect(message).toContain("write source: parks instead");
  });

  it("a layers: entry $ref naming no layer is an error at its line", () => {
    const result = YAMLParser.safeParseAny(
      root("#/sources/quakes").replace('- $ref: "#/layers/shared"', '- $ref: "#/layers/shard"')
    ).result;
    expect(result.success).toBe(false);
    expect(errorAt(result.errors, "pages.0.blocks.0.layers.1.$ref")).toMatchObject({
      line: 27,
      suggestion: "#/layers/shared",
    });
  });
});

describe("v2", () => {
  it("is not checked here: its schema already rejects a $ref source, once", () => {
    const result = YAMLParser.safeParseMapBlock(`type: map
version: 2
id: m
runtime:
  map:
    center: [0, 0]
    zoom: 2
style:
  basemap: https://example.com/style.json
  sources:
    quakes:
      type: geojson
      data: ${EMPTY}
  layers:
    - id: dots
      type: circle
      source:
        $ref: "#/sources/quake"
`);
    expect(result.success).toBe(false);
    expect(result.errors.filter((e) => e.path.startsWith("style.layers.0.source"))).toHaveLength(1);
  });
});

describe('a reference written as a string, source: "#/sources/name"', () => {
  it("is an error even on a raster layer, which an ordinary unknown name only warns on", () => {
    const result = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
sources:
  sat:
    type: raster
    tiles: ["https://example.com/{z}/{x}/{y}.png"]
layers:
  - id: imagery
    type: raster
    source: "#/sources/sat"
`);
    expect(result.success).toBe(false);
    const error = errorAt(result.errors, "layers.0.source");
    expect(error).toMatchObject({ line: 14 });
    expect(error!.message).toBe(
      'Layer "imagery" writes a reference as a plain string, source: "#/sources/sat", which is never resolved. ' +
        'Write source: { $ref: "#/sources/sat" } or source: sat.'
    );
  });
});
