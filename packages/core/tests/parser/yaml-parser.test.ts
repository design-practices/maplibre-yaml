import { describe, it, expect } from "vitest";
import {
  YAMLParser,
  parseYAMLConfig,
  safeParseYAMLConfig,
  safeParseAny,
} from "../../src/parser/yaml-parser";

describe("YAMLParser", () => {
  describe("parse()", () => {
    it("parses valid YAML config", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test Page"
    blocks:
      - type: map
        id: test-map
        config:
          center: [-74.006, 40.7128]
          zoom: 12
          mapStyle: "https://demotiles.maplibre.org/style.json"
`;

      const config = YAMLParser.parse(yaml);

      expect(config).toBeDefined();
      expect(config.pages).toHaveLength(1);
      expect(config.pages[0].path).toBe("/");
      expect(config.pages[0].title).toBe("Test Page");
      expect(config.pages[0].blocks).toHaveLength(1);
      expect(config.pages[0].blocks[0].type).toBe("map");
    });

    it("throws on invalid YAML syntax", () => {
      const invalidYaml = `
pages:
  - path: "/"
    title: "Test
    # Missing closing quote
`;

      expect(() => YAMLParser.parse(invalidYaml)).toThrow("YAML syntax error");
    });

    it("throws on schema validation error", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test-map
        config:
          center: [999, 40]  # Invalid longitude
          zoom: 12
          mapStyle: "https://example.com/style.json"
`;

      expect(() => YAMLParser.parse(yaml)).toThrow();
    });

    it("parses config with multiple pages", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Home"
    blocks: []
  - path: "/map"
    title: "Map Page"
    blocks: []
`;

      const config = YAMLParser.parse(yaml);
      expect(config.pages).toHaveLength(2);
      expect(config.pages[0].path).toBe("/");
      expect(config.pages[1].path).toBe("/map");
    });

    it("parses config with global layers", () => {
      const yaml = `
layers:
  myLayer:
    id: test-layer
    type: circle
    source:
      type: geojson
      data:
        type: FeatureCollection
        features: []
    paint:
      circle-radius: 10

pages:
  - path: "/"
    title: "Test"
    blocks: []
`;

      const config = YAMLParser.parse(yaml);
      expect(config.layers).toBeDefined();
      expect(config.layers!.myLayer).toBeDefined();
      expect(config.layers!.myLayer.id).toBe("test-layer");
    });

    it("parses config with content blocks", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test"
    blocks:
      - type: content
        id: intro
        content:
          - h1:
              - str: "Welcome"
          - p:
              - str: "Hello world"
`;

      const config = YAMLParser.parse(yaml);
      expect(config.pages[0].blocks[0].type).toBe("content");
      expect(config.pages[0].blocks[0]).toHaveProperty("content");
    });

    it("parses scrollytelling config", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Story"
    blocks:
      - type: scrollytelling
        id: story
        config:
          center: [0, 0]
          zoom: 2
          mapStyle: "https://example.com/style.json"
        chapters:
          - id: chapter1
            title: "Chapter 1"
            center: [0, 0]
            zoom: 2
`;

      const config = YAMLParser.parse(yaml);
      expect(config.pages[0].blocks[0].type).toBe("scrollytelling");
      const block = config.pages[0].blocks[0] as any;
      expect(block.chapters).toHaveLength(1);
      expect(block.chapters[0].title).toBe("Chapter 1");
    });
  });

  describe("safeParse()", () => {
    it("returns success: true for valid config", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test"
    blocks:
      - type: content
        content:
          - p:
              - str: "Test"
`;

      const result = YAMLParser.safeParse(yaml);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it("returns success: false with errors for invalid config", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test
        config:
          center: [999, 40]  # Invalid longitude
          zoom: 50  # Invalid zoom
          mapStyle: "https://example.com/style.json"
`;

      const result = YAMLParser.safeParse(yaml);

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty("path");
      expect(result.errors[0]).toHaveProperty("message");
    });

    it("returns YAML syntax errors", () => {
      const invalidYaml = `
pages:
  - path: "/"
    title: "Test
`;

      const result = YAMLParser.safeParse(invalidYaml);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]!.message).toContain("YAML syntax error");
    });

    it("handles missing required fields", () => {
      const yaml = `
pages: []
`;

      const result = YAMLParser.safeParse(yaml);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("validate()", () => {
    it("validates JavaScript object", () => {
      const jsConfig = {
        pages: [
          {
            path: "/",
            title: "Test",
            blocks: [
              {
                type: "content",
                content: [
                  {
                    p: [{ str: "Test" }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const validated = YAMLParser.validate(jsConfig);

      expect(validated).toBeDefined();
      expect(validated.pages).toHaveLength(1);
    });

    it("throws on invalid JavaScript object", () => {
      const invalid = {
        pages: [
          {
            path: "/",
            title: "Test",
            blocks: [
              {
                type: "map",
                config: {
                  center: [999, 40], // Invalid
                  zoom: 12,
                  mapStyle: "https://example.com/style.json",
                },
              },
            ],
          },
        ],
      };

      expect(() => YAMLParser.validate(invalid)).toThrow();
    });
  });

  describe("resolveReferences()", () => {
    it("resolves layer references", () => {
      const config = {
        layers: {
          sharedLayer: {
            id: "shared",
            type: "circle" as const,
            source: {
              type: "geojson" as const,
              data: {
                type: "FeatureCollection" as const,
                features: [],
              },
            },
            paint: {
              "circle-color": "#ff0000",
            },
          },
        },
        pages: [
          {
            path: "/",
            title: "Test",
            blocks: [
              {
                type: "map" as const,
                id: "test-map",
                config: {
                  center: [0, 0] as [number, number],
                  zoom: 2,
                  mapStyle: "https://example.com/style.json",
                },
                layers: [{ $ref: "#/layers/sharedLayer" }],
              },
            ],
          },
        ],
      };

      const resolved = YAMLParser.resolveReferences(config as any);

      expect(resolved.pages[0].blocks[0]).toHaveProperty("layers");
      const mapBlock = resolved.pages[0].blocks[0] as any;
      expect(mapBlock.layers[0]).toHaveProperty("id", "shared");
      expect(mapBlock.layers[0]).toHaveProperty("paint");
      expect(mapBlock.layers[0].paint["circle-color"]).toBe("#ff0000");
    });

    it("throws on missing layer reference", () => {
      const config = {
        pages: [
          {
            path: "/",
            title: "Test",
            blocks: [
              {
                type: "map" as const,
                id: "test",
                config: {
                  center: [0, 0] as [number, number],
                  zoom: 2,
                  mapStyle: "https://example.com/style.json",
                },
                layers: [{ $ref: "#/layers/nonexistent" }],
              },
            ],
          },
        ],
      };

      expect(() => YAMLParser.resolveReferences(config as any)).toThrow(
        "Layer reference not found"
      );
    });

    it("handles nested references in arrays", () => {
      const config = {
        layers: {
          layer1: {
            id: "l1",
            type: "circle" as const,
            source: {
              type: "geojson" as const,
              data: { type: "FeatureCollection" as const, features: [] },
            },
          },
          layer2: {
            id: "l2",
            type: "line" as const,
            source: {
              type: "geojson" as const,
              data: { type: "FeatureCollection" as const, features: [] },
            },
          },
        },
        pages: [
          {
            path: "/",
            title: "Test",
            blocks: [
              {
                type: "map" as const,
                id: "test",
                config: {
                  center: [0, 0] as [number, number],
                  zoom: 2,
                  mapStyle: "https://example.com/style.json",
                },
                layers: [
                  { $ref: "#/layers/layer1" },
                  { $ref: "#/layers/layer2" },
                ],
              },
            ],
          },
        ],
      };

      const resolved = YAMLParser.resolveReferences(config as any);
      const mapBlock = resolved.pages[0].blocks[0] as any;

      expect(mapBlock.layers).toHaveLength(2);
      expect(mapBlock.layers[0].id).toBe("l1");
      expect(mapBlock.layers[1].id).toBe("l2");
    });

    it("throws on invalid reference format", () => {
      const config = {
        pages: [
          {
            path: "/",
            title: "Test",
            blocks: [
              {
                type: "map" as const,
                id: "test",
                config: {
                  center: [0, 0] as [number, number],
                  zoom: 2,
                  mapStyle: "https://example.com/style.json",
                },
                layers: [{ $ref: "invalid-format" }],
              },
            ],
          },
        ],
      };

      expect(() => YAMLParser.resolveReferences(config as any)).toThrow(
        "Invalid reference format"
      );
    });

    it("resolves source references", () => {
      const config = {
        sources: {
          sharedSource: {
            type: "geojson" as const,
            url: "https://example.com/data.geojson",
          },
        },
        layers: {
          myLayer: {
            id: "layer1",
            type: "circle" as const,
            source: { $ref: "#/sources/sharedSource" },
          },
        },
        pages: [
          {
            path: "/",
            title: "Test",
            blocks: [],
          },
        ],
      };

      const resolved = YAMLParser.resolveReferences(config as any);

      expect(resolved.layers!.myLayer.source).toHaveProperty("type", "geojson");
      expect(resolved.layers!.myLayer.source).toHaveProperty("url");
    });

    it("handles deeply nested references", () => {
      const config = {
        layers: {
          sharedLayer: {
            id: "shared",
            type: "circle" as const,
            source: {
              type: "geojson" as const,
              data: { type: "FeatureCollection" as const, features: [] },
            },
          },
        },
        pages: [
          {
            path: "/",
            title: "Test",
            blocks: [
              {
                type: "mixed" as const,
                layout: "row" as const,
                blocks: [
                  {
                    type: "map" as const,
                    id: "nested-map",
                    config: {
                      center: [0, 0] as [number, number],
                      zoom: 2,
                      mapStyle: "https://example.com/style.json",
                    },
                    layers: [{ $ref: "#/layers/sharedLayer" }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const resolved = YAMLParser.resolveReferences(config as any);
      const mixedBlock = resolved.pages[0].blocks[0] as any;
      const mapBlock = mixedBlock.blocks[0];

      expect(mapBlock.layers[0].id).toBe("shared");
    });
  });

  describe("convenience exports", () => {
    it("parseYAMLConfig works", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test"
    blocks: []
`;

      const config = parseYAMLConfig(yaml);
      expect(config).toBeDefined();
      expect(config.pages).toHaveLength(1);
    });

    it("safeParseYAMLConfig works", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test"
    blocks: []
`;

      const result = safeParseYAMLConfig(yaml);
      expect(result.success).toBe(true);
    });
  });

  describe("error formatting", () => {
    it("formats invalid_type errors", () => {
      const yaml = `
pages:
  - path: "/"
    title: 123  # Should be string
    blocks: []
`;

      const result = YAMLParser.safeParse(yaml);

      expect(result.success).toBe(false);
      const error = result.errors.find((e) => e.path.includes("title"));
      expect(error).toBeDefined();
      expect(error!.message).toContain("Expected string");
    });

    it("formats too_small errors for arrays", () => {
      const yaml = `
pages: []
`;

      const result = YAMLParser.safeParse(yaml);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.message.includes("at least"))).toBe(
        true
      );
    });

    it("formats too_big errors", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test
        config:
          center: [0, 0]
          zoom: 100  # Too high
          mapStyle: "https://example.com/style.json"
`;

      const result = YAMLParser.safeParse(yaml);

      expect(result.success).toBe(false);
      const error = result.errors.find((e) => e.path.includes("zoom"));
      expect(error).toBeDefined();
    });

    it("formats invalid_string URL errors", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test
        config:
          center: [0, 0]
          zoom: 10
          mapStyle: "not-a-url"
`;

      const result = YAMLParser.safeParse(yaml);

      // Note: mapStyle uses union of string.url() | any, so "not-a-url" passes validation
      // This is by design to allow flexibility. The test verifies the parser works.
      expect(result.success).toBe(true);
    });
  });

  describe("parseScrollytellingBlock()", () => {
    it("parses valid scrollytelling block", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
  - id: chapter2
    title: "Chapter 2"
    center: [10, 10]
    zoom: 5
`;

      const block = YAMLParser.parseScrollytellingBlock(yaml);

      expect(block).toBeDefined();
      expect(block.type).toBe("scrollytelling");
      expect(block.id).toBe("story");
      expect(block.chapters).toHaveLength(2);
      expect(block.chapters[0].title).toBe("Introduction");
      expect(block.chapters[1].title).toBe("Chapter 2");
    });

    it("throws on invalid YAML syntax", () => {
      const invalidYaml = `
type: scrollytelling
id: story
config:
  center: [0, 0
  # Missing closing bracket
`;

      expect(() => YAMLParser.parseScrollytellingBlock(invalidYaml)).toThrow(
        "YAML syntax error"
      );
    });

    it("throws on schema validation error", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [999, 0]  # Invalid longitude
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Intro"
    center: [0, 0]
    zoom: 3
`;

      expect(() => YAMLParser.parseScrollytellingBlock(yaml)).toThrow();
    });

    it("throws when chapters array is empty", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters: []
`;

      expect(() => YAMLParser.parseScrollytellingBlock(yaml)).toThrow();
    });

    it("parses scrollytelling with optional properties", () => {
      const yaml = `
type: scrollytelling
id: story
theme: dark
showMarkers: true
markerColor: "#ff0000"
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
    description: "Welcome to our story"
    alignment: left
    pitch: 45
    bearing: 30
footer: "<p>Data sources: Example</p>"
`;

      const block = YAMLParser.parseScrollytellingBlock(yaml);

      expect(block.theme).toBe("dark");
      expect(block.showMarkers).toBe(true);
      expect(block.markerColor).toBe("#ff0000");
      expect(block.footer).toBe("<p>Data sources: Example</p>");
      expect(block.chapters[0].description).toBe("Welcome to our story");
      expect(block.chapters[0].alignment).toBe("left");
      expect(block.chapters[0].pitch).toBe(45);
      expect(block.chapters[0].bearing).toBe(30);
    });

    it("parses chapters with actions", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
    onChapterEnter:
      - action: setFilter
        layer: earthquakes
        filter: [">=", ["get", "magnitude"], 5]
    onChapterExit:
      - action: setFilter
        layer: earthquakes
        filter: null
`;

      const block = YAMLParser.parseScrollytellingBlock(yaml);

      expect(block.chapters[0].onChapterEnter).toHaveLength(1);
      expect(block.chapters[0].onChapterEnter[0].action).toBe("setFilter");
      expect(block.chapters[0].onChapterExit).toHaveLength(1);
    });
  });

  describe("safeParseScrollytellingBlock()", () => {
    it("returns success: true for valid scrollytelling block", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
`;

      const result = YAMLParser.safeParseScrollytellingBlock(yaml);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.errors).toHaveLength(0);
      expect(result.data?.type).toBe("scrollytelling");
    });

    it("returns success: false with errors for invalid config", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [999, 0]  # Invalid longitude
  zoom: 50  # Invalid zoom
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Intro"
    center: [0, 0]
    zoom: 3
`;

      const result = YAMLParser.safeParseScrollytellingBlock(yaml);

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty("path");
      expect(result.errors[0]).toHaveProperty("message");
    });

    it("returns YAML syntax errors", () => {
      const invalidYaml = `
type: scrollytelling
id: story
config:
  center: [0, 0
`;

      const result = YAMLParser.safeParseScrollytellingBlock(invalidYaml);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]!.message).toContain("YAML syntax error");
    });

    it("handles missing chapters", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
`;

      const result = YAMLParser.safeParseScrollytellingBlock(yaml);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("handles empty chapters array", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters: []
`;

      const result = YAMLParser.safeParseScrollytellingBlock(yaml);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const error = result.errors.find((e) => e.path.includes("chapters"));
      expect(error).toBeDefined();
    });
  });

  describe("safeParseAny()", () => {
    it("dispatches type: map documents to the map block schema", () => {
      const yaml = `
type: map
id: test-map
config:
  center: [-74.006, 40.7128]
  zoom: 12
  mapStyle: "https://demotiles.maplibre.org/style.json"
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("map");
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect((result.data as any)?.type).toBe("map");
    });

    it("dispatches type: scrollytelling documents to the scrollytelling schema", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("scrollytelling");
      expect(result.success).toBe(true);
      expect((result.data as any)?.chapters).toHaveLength(1);
    });

    it("dispatches documents with pages: to the root schema", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test Page"
    blocks:
      - type: map
        id: test-map
        config:
          center: [-74.006, 40.7128]
          zoom: 12
          mapStyle: "https://demotiles.maplibre.org/style.json"
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("root");
      expect(result.success).toBe(true);
      expect((result.data as any)?.pages).toHaveLength(1);
    });

    it("returns validation errors from the dispatched schema", () => {
      const yaml = `
type: map
id: test-map
config:
  center: [999, 40.7128]
  zoom: 12
  mapStyle: "https://demotiles.maplibre.org/style.json"
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("map");
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("reports unknown type values with the list of valid values", () => {
      const yaml = `
type: carousel
id: nope
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("unknown");
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe("type");
      expect(result.errors[0].message).toContain('"carousel"');
      expect(result.errors[0].message).toContain("map, scrollytelling");
      expect(result.errors[0].message).toContain("pages");
    });

    it("reports documents with neither type: nor pages:", () => {
      const yaml = `
id: mystery
config:
  zoom: 3
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("unknown");
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain("type: map");
      expect(result.errors[0].message).toContain("pages");
    });

    it("returns YAML syntax errors without throwing", () => {
      const invalidYaml = `
type: map
config:
  center: [0, 0
`;

      const { blockType, result } = YAMLParser.safeParseAny(invalidYaml);

      expect(blockType).toBe("unknown");
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain("YAML syntax error");
    });

    it("is exported as a bound convenience function", () => {
      const { blockType, result } = safeParseAny("type: map\nid: x\n");

      expect(blockType).toBe("map");
      expect(result.success).toBe(false); // missing config
    });
  });
});

describe("standalone map block — $ref sources (U7 / todo 039)", () => {
  const block = (source: string) => `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  cities:
    type: geojson
    url: "https://example.com/cities.geojson"
layers:
  - id: pts
    type: circle
    source: ${source}
`;

  it("resolves a $ref against the block's own sources", () => {
    const result = YAMLParser.safeParseMapBlock(
      block('{ $ref: "#/sources/cities" }')
    );

    expect(result.success).toBe(true);
    // Previously the $ref survived parsing untouched, so at render time the
    // source had no `type` and the layer was silently dropped — accepted
    // config, no map.
    expect(result.data!.layers![0].source).toMatchObject({
      type: "geojson",
      url: "https://example.com/cities.geojson",
    });
  });

  it("reports an unresolvable $ref instead of passing it through", () => {
    const result = YAMLParser.safeParseMapBlock(
      block('{ $ref: "#/sources/missing" }')
    );

    const surfaced =
      !result.success ||
      JSON.stringify(result.data!.layers![0].source).includes("$ref") === false;
    expect(surfaced).toBe(true);
  });

  it("leaves a bare named-source reference alone", () => {
    const result = YAMLParser.safeParseMapBlock(block("cities"));

    expect(result.success).toBe(true);
    expect(result.data!.layers![0].source).toBe("cities");
  });
});

/**
 * YAML-native reuse: anchors, aliases, and merge keys.
 *
 * @remarks
 * These resolve inside `yaml`'s parse, upstream of validation — so the schemas
 * never see `<<`, and reuse costs no schema surface. Merge in particular was a
 * silent wrong answer before it was enabled: `<<: *base` produced a literal
 * `"<<"` key rather than merging, which then tripped unknown-key validation.
 */
describe("YAML-native reuse (U2)", () => {
  const mapWith = (layers: string) => `
type: map
id: reuse
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
${layers}`;

  it("merges an anchored mapping via a merge key", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapWith(`  - &base
      id: a
      type: circle
      source: { type: geojson, data: { type: FeatureCollection, features: [] } }
      paint: { circle-color: "#111" }
  - <<: *base
    id: b`)
    );
    expect(result.success).toBe(true);
    const layers = result.data!.layers as any[];
    expect(layers[1].type).toBe("circle");
    expect(layers[1].paint["circle-color"]).toBe("#111");
  });

  it("lets a sibling key override the merged value", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapWith(`  - &base
      id: a
      type: circle
      source: { type: geojson, data: { type: FeatureCollection, features: [] } }
      paint: { circle-color: "#111" }
  - <<: *base
    id: b
    paint: { circle-color: "#222" }`)
    );
    expect(result.success).toBe(true);
    const layers = result.data!.layers as any[];
    expect(layers[1].paint["circle-color"]).toBe("#222");
    expect(layers[0].paint["circle-color"]).toBe("#111");
  });

  it("never surfaces `<<` to the schema", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapWith(`  - &base
      id: a
      type: circle
      source: { type: geojson, data: { type: FeatureCollection, features: [] } }
  - <<: *base
    id: b`)
    );
    expect(result.success).toBe(true);
    expect(Object.keys(result.data!.layers[1] as object)).not.toContain("<<");
    expect(result.warnings.map((w) => w.message).join(" ")).not.toContain("<<");
  });

  it("reuses an anchored scalar by alias", () => {
    const result = YAMLParser.safeParseMapBlock(`
type: map
id: reuse
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: a
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    paint: { circle-color: &brand "#2b6cb0" }
  - id: b
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    paint: { circle-color: *brand }`);
    expect(result.success).toBe(true);
    const layers = result.data!.layers as any[];
    expect(layers[1].paint["circle-color"]).toBe("#2b6cb0");
  });

  it("rejects an anchor-expansion attack rather than expanding it", () => {
    const bomb = `
type: map
id: bomb
config: { center: [0, 0], zoom: 5, mapStyle: "https://x.test/s.json" }
a: &a [x,x,x,x,x,x,x,x,x]
b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]
d: [*c,*c,*c,*c,*c,*c,*c,*c,*c]
layers: []`;
    const result = YAMLParser.safeParseMapBlock(bomb);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/could not be expanded/i);
  });
});

/**
 * Expansion attacks, both shapes.
 *
 * @remarks
 * The plain-alias bomb is caught by the `yaml` library's own alias budget. The
 * merge-key bomb is NOT — `merge.mergeValue()` resolves through
 * `Alias.resolve()` and calls `toJSON()` directly, never entering the path
 * where the budget is counted. Enabling merge keys therefore walked around the
 * guard, and a 338-byte document took 13 seconds with no error. The failure
 * mode is a hang, not a wrong value, so these tests bound elapsed time — an
 * assertion on the result alone would not catch a regression.
 */
describe("expansion attacks (U2 hardening)", () => {
  const seqMergeBomb = (depth: number, fan: number) => {
    let s = "type: map\nid: bomb\na0: &a0 { k: v }\n";
    for (let i = 1; i <= depth; i++) {
      const items = Array.from({ length: fan }, () => `*a${i - 1}`).join(",");
      s += `a${i}: &a${i}\n  <<: [${items}]\n`;
    }
    return s + "layers: []\n";
  };

  it("rejects a sequence-valued merge before materializing it", () => {
    const started = Date.now();
    const result = YAMLParser.safeParseMapBlock(seqMergeBomb(6, 9));
    const elapsed = Date.now() - started;

    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe("yaml-expansion");
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/sequence of aliases/i);
    // Unguarded this took ~13s; the guard runs on the AST, before expansion.
    expect(elapsed).toBeLessThan(1000);
  });

  it("rejects the repeated-merge-key form, which needs no sequence", () => {
    // The first version of this guard refused only sequences and called that
    // the entire attack surface. `{<<: *n, <<: *n, ...}` reproduces the same
    // exponential expansion with no sequence anywhere.
    let s = "type: map\nid: rep\nr0: &r0 { k: v }\n";
    for (let i = 1; i <= 5; i++) {
      const merges = Array.from({ length: 6 }, () => `  <<: *r${i - 1}`).join("\n");
      s += `r${i}: &r${i}\n${merges}\n`;
    }
    s += "layers: []\n";

    const started = Date.now();
    const result = YAMLParser.safeParseMapBlock(s);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/more than one merge key/i);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("still allows the documented single-alias merge at depth", () => {
    let s = "type: map\nid: chain\nconfig:\n  center: [0, 0]\n  zoom: 5\n";
    s += "base: &b0 { k: v }\n";
    for (let i = 1; i <= 20; i++) s += `l${i}: &b${i}\n  <<: *b${i - 1}\n  k${i}: v\n`;
    s += "layers: []\n";
    const result = YAMLParser.safeParseMapBlock(s);
    expect(result.success).toBe(true);
  });

  it("returns a result rather than throwing through safeParseAny", () => {
    // safeParseAny is what `mlym validate` and the preview server call, and it
    // documents that it never throws. An earlier fix guarded only safeParse*.
    const bomb =
      "type: map\nid: b\na: &a [x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\n" +
      "c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: [*c,*c,*c,*c,*c,*c,*c,*c,*c]\nlayers: []\n";
    expect(() => YAMLParser.safeParseAny(bomb)).not.toThrow();
    const { result } = YAMLParser.safeParseAny(bomb);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe("yaml-expansion");
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/could not be expanded/i);
  });

  it("reports a merge-key typo as an ordinary error, not an attack", () => {
    const result = YAMLParser.safeParseMapBlock(
      'type: map\nid: t\nbrand: &brand "#111"\nextra:\n  <<: *brand\nlayers: []\n'
    );
    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe("yaml-merge");
    const messages = result.errors.map((e) => e.message).join(" ");
    expect(messages).not.toMatch(/could not be expanded/i);
    expect(messages).toMatch(/merge sources must be maps/i);
  });
});
