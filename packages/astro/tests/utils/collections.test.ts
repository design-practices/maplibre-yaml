/**
 * @file Tests for content collection schema helpers
 * @module @maplibre-yaml/astro/tests/utils/collections
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  getMapSchema,
  getScrollytellingSchema,
  getChapterSchema,
  getSimpleMapSchema,
  extendSchema,
} from "../../src/utils/collections";

describe("getMapSchema", () => {
  it("returns a valid Zod schema", () => {
    const schema = getMapSchema();

    expect(schema).toBeDefined();
    expect(schema instanceof z.ZodType).toBe(true);
  });

  it("validates correct map configuration", () => {
    const schema = getMapSchema();

    const validMap = {
      type: "map",
      id: "test-map",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
    };

    expect(() => schema.parse(validMap)).not.toThrow();
  });

  it("rejects invalid map configuration", () => {
    const schema = getMapSchema();

    const invalidMap = {
      type: "map",
      id: "bad-map",
      config: {
        center: [999, 0], // Invalid longitude
        zoom: 100, // Invalid zoom
        mapStyle: "https://example.com/style.json",
      },
    };

    expect(() => schema.parse(invalidMap)).toThrow();
  });

  it("validates map with layers", () => {
    const schema = getMapSchema();

    const mapWithLayers = {
      type: "map",
      id: "layered",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
      layers: [
        {
          id: "points",
          type: "circle",
          source: {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [],
            },
          },
          paint: {
            "circle-radius": 5,
            "circle-color": "#ff0000",
          },
        },
      ],
    };

    expect(() => schema.parse(mapWithLayers)).not.toThrow();
  });
});

describe("getScrollytellingSchema", () => {
  it("returns a valid Zod schema", () => {
    const schema = getScrollytellingSchema();

    expect(schema).toBeDefined();
    expect(schema instanceof z.ZodType).toBe(true);
  });

  it("validates correct scrollytelling configuration", () => {
    const schema = getScrollytellingSchema();

    const validScrolly = {
      type: "scrollytelling",
      id: "story",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
      chapters: [
        {
          id: "intro",
          title: "Introduction",
          center: [0, 0],
          zoom: 3,
        },
      ],
    };

    expect(() => schema.parse(validScrolly)).not.toThrow();
  });

  it("rejects scrollytelling without chapters", () => {
    const schema = getScrollytellingSchema();

    const noChapters = {
      type: "scrollytelling",
      id: "story",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
      chapters: [],
    };

    expect(() => schema.parse(noChapters)).toThrow();
  });

  it("validates scrollytelling with optional properties", () => {
    const schema = getScrollytellingSchema();

    const fullScrolly = {
      type: "scrollytelling",
      id: "story",
      theme: "dark",
      showMarkers: true,
      markerColor: "#ff0000",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
      chapters: [
        {
          id: "intro",
          title: "Intro",
          center: [0, 0],
          zoom: 3,
          description: "Welcome",
          alignment: "left",
          pitch: 45,
        },
      ],
      footer: "<p>Sources</p>",
    };

    const result = schema.parse(fullScrolly);
    expect(result.theme).toBe("dark");
    expect(result.showMarkers).toBe(true);
    expect(result.footer).toBe("<p>Sources</p>");
  });
});

describe("getChapterSchema", () => {
  it("returns a valid Zod schema", () => {
    const schema = getChapterSchema();

    expect(schema).toBeDefined();
    expect(schema instanceof z.ZodType).toBe(true);
  });

  it("validates correct chapter configuration", () => {
    const schema = getChapterSchema();

    const validChapter = {
      id: "chapter1",
      title: "Chapter 1",
      center: [0, 0],
      zoom: 5,
    };

    expect(() => schema.parse(validChapter)).not.toThrow();
  });

  it("validates chapter with optional properties", () => {
    const schema = getChapterSchema();

    const fullChapter = {
      id: "chapter1",
      title: "Chapter 1",
      center: [0, 0],
      zoom: 5,
      description: "This is chapter 1",
      image: "https://example.com/image.jpg",
      video: "https://example.com/video.mp4",
      pitch: 45,
      bearing: 30,
      alignment: "left",
    };

    const result = schema.parse(fullChapter);
    expect(result.description).toBe("This is chapter 1");
    expect(result.image).toBe("https://example.com/image.jpg");
  });

  it("validates chapter with actions", () => {
    const schema = getChapterSchema();

    const chapterWithActions = {
      id: "chapter1",
      title: "Chapter 1",
      center: [0, 0],
      zoom: 5,
      onChapterEnter: [
        {
          action: "setFilter",
          layer: "points",
          filter: [">=", ["get", "value"], 10],
        },
      ],
      onChapterExit: [
        {
          action: "setFilter",
          layer: "points",
          filter: null,
        },
      ],
    };

    expect(() => schema.parse(chapterWithActions)).not.toThrow();
  });

  it("rejects chapter with invalid camera angles", () => {
    const schema = getChapterSchema();

    const invalidChapter = {
      id: "chapter1",
      title: "Chapter 1",
      center: [0, 0],
      zoom: 5,
      pitch: 100, // Too high
    };

    expect(() => schema.parse(invalidChapter)).toThrow();
  });
});

describe("getSimpleMapSchema", () => {
  it("returns a valid Zod schema", () => {
    const schema = getSimpleMapSchema();

    expect(schema).toBeDefined();
    expect(schema instanceof z.ZodType).toBe(true);
  });

  it("validates simple map config", () => {
    const schema = getSimpleMapSchema();

    const simpleConfig = {
      center: [-122.4194, 37.7749],
      zoom: 12,
      mapStyle: "https://demotiles.maplibre.org/style.json",
    };

    expect(() => schema.parse(simpleConfig)).not.toThrow();
  });

  it("validates map config with optional properties", () => {
    const schema = getSimpleMapSchema();

    const fullConfig = {
      center: [-122.4194, 37.7749],
      zoom: 12,
      pitch: 45,
      bearing: 0,
      mapStyle: "https://demotiles.maplibre.org/style.json",
      minZoom: 0,
      maxZoom: 22,
    };

    const result = schema.parse(fullConfig);
    expect(result.pitch).toBe(45);
    expect(result.bearing).toBe(0);
  });

  it("rejects invalid coordinates", () => {
    const schema = getSimpleMapSchema();

    const invalidConfig = {
      center: [999, 40],
      zoom: 12,
      mapStyle: "https://example.com/style.json",
    };

    expect(() => schema.parse(invalidConfig)).toThrow();
  });
});

describe("extendSchema", () => {
  it("extends object schema with additional properties", () => {
    const baseSchema = getMapSchema();
    const extended = extendSchema(baseSchema, {
      author: z.string(),
      publishDate: z.date(),
      tags: z.array(z.string()),
    });

    const validData = {
      type: "map",
      id: "test",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
      author: "John Doe",
      publishDate: new Date("2024-01-01"),
      tags: ["earthquakes", "geoscience"],
    };

    expect(() => extended.parse(validData)).not.toThrow();
  });

  it("validates extended properties", () => {
    const baseSchema = getMapSchema();
    const extended = extendSchema(baseSchema, {
      featured: z.boolean(),
    });

    const invalidData = {
      type: "map",
      id: "test",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
      featured: "not a boolean",
    };

    expect(() => extended.parse(invalidData)).toThrow();
  });

  it("creates object schema for non-object base schema", () => {
    const baseSchema = z.string();
    const extended = extendSchema(baseSchema, {
      metadata: z.string(),
    });

    expect(extended instanceof z.ZodObject).toBe(true);
    expect(() => extended.parse({ metadata: "test" })).not.toThrow();
  });

  it("preserves base schema validation", () => {
    const baseSchema = getMapSchema();
    const extended = extendSchema(baseSchema, {
      custom: z.string(),
    });

    const invalidBase = {
      type: "map",
      id: "test",
      config: {
        center: [999, 0], // Invalid
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
      custom: "value",
    };

    expect(() => extended.parse(invalidBase)).toThrow();
  });

  it("allows optional extended properties with defaults", () => {
    const baseSchema = getMapSchema();
    const extended = extendSchema(baseSchema, {
      featured: z.boolean().default(false),
      priority: z.number().default(0),
    });

    const dataWithoutExtensions = {
      type: "map",
      id: "test",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
    };

    const result = extended.parse(dataWithoutExtensions);
    expect(result.featured).toBe(false);
    expect(result.priority).toBe(0);
  });
});
