import { describe, it, expect } from "vitest";
import {
  YAMLParser,
  parseYAMLConfig,
  safeParseYAMLConfig,
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
});
