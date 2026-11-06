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
import { ChapterSchema, MapConfigSchema } from "@maplibre-yaml/core";

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
  it("returns core's zod-3 schema itself on a zod-3 host", () => {
    const schema = getChapterSchema();

    // Not `instanceof z.ZodType`: core's zod may be a different copy from
    // the host's (see "core schemas on a zod-3 host" below).
    expect(schema).toBe(ChapterSchema);
    expect((schema as unknown as { _def: { typeName: string } })._def.typeName).toBe("ZodObject");
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
  it("returns core's zod-3 schema itself on a zod-3 host", () => {
    const schema = getSimpleMapSchema();

    // Not `instanceof z.ZodType`: core's zod may be a different copy from
    // the host's (see "core schemas on a zod-3 host" below).
    expect(schema).toBe(MapConfigSchema);
    expect((schema as unknown as { _def: { typeName: string } })._def.typeName).toBe("ZodObject");
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

/**
 * Core's value normalizations (0.10): Astro parses a collection's TOML (or
 * YAML) file itself, so its dates arrive as objects and its locale as nested
 * tables. The collection schemas normalize them first, as a loaded file is.
 */
describe("collection entries are normalized like loaded documents", () => {
  /** smol-toml's TomlDate: a Date whose toISOString() is the text as written. */
  class TomlDate extends Date {
    constructor(private readonly text: string) {
      super(text);
    }
    override toISOString(): string {
      return this.text;
    }
  }

  const tomlEntry = () => ({
    $schema: "https://docs.maplibre-yaml.org/schema/latest/map.schema.json",
    type: "map",
    id: "dated",
    title: "Heat",
    config: {
      center: [0, 0],
      zoom: 2,
      mapStyle: "https://demotiles.maplibre.org/style.json",
      locale: {
        "Popup.Close": "Cerrar",
        NavigationControl: { ZoomIn: "Acercar", ZoomOut: "Alejar" },
      },
    },
    sources: {
      pts: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: { observed: new TomlDate("2024-01-02"), at: new Date("2024-01-02T03:04:05Z") },
            },
          ],
        },
      },
    },
  });

  it("getMapSchema: a TOML date, a YAML Date, a nested locale and a root $schema validate", () => {
    const entry = tomlEntry();
    const result = getMapSchema().safeParse(entry);
    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.config.locale).toEqual({
      "Popup.Close": "Cerrar",
      "NavigationControl.ZoomIn": "Acercar",
      "NavigationControl.ZoomOut": "Alejar",
    });
    expect(data.sources.pts.data.features[0].properties).toEqual({
      observed: "2024-01-02",
      at: "2024-01-02T03:04:05.000Z",
    });
    expect(data).not.toHaveProperty("$schema");
    // The entry Astro handed over is not changed.
    expect(entry.config.locale.NavigationControl).toEqual({ ZoomIn: "Acercar", ZoomOut: "Alejar" });
    expect(entry.sources.pts.data.features[0]!.properties.observed).toBeInstanceOf(TomlDate);
  });

  it("matches what core makes of the same value", async () => {
    const { YAMLParser } = await import("@maplibre-yaml/core");
    const core = YAMLParser.safeParseMapBlockValue(tomlEntry());
    expect(core.success).toBe(true);
    const result = getMapSchema().safeParse(tomlEntry());
    expect((result.data as any).config.locale).toEqual((core.data as any).config.locale);
    expect((result.data as any).sources.pts.data).toEqual((core.data as any).sources.pts.data);
  });

  it("a key written both nested and dotted fails, naming both spellings, as core does", async () => {
    const entry = tomlEntry() as any;
    entry.config.locale["NavigationControl.ZoomIn"] = "Ampliar";
    const result = getMapSchema().safeParse(entry);
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect(issue.path).toEqual(["config", "locale", "NavigationControl.ZoomIn"]);

    const { YAMLParser } = await import("@maplibre-yaml/core");
    const core = YAMLParser.safeParseMapBlockValue(entry);
    expect(core.success).toBe(false);
    expect(issue.message).toBe(core.errors[0]!.message);
    expect(issue.message).toMatch(/written twice/);
  });

  it("getScrollytellingSchema: a nested locale and a date validate", () => {
    const result = getScrollytellingSchema().safeParse({
      type: "scrollytelling",
      id: "story",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
        locale: { Popup: { Close: "Cerrar" } },
      },
      chapters: [
        { id: "a", title: "A", center: [0, 0], zoom: 2, description: new TomlDate("1883-08-27") },
      ],
    });
    expect(result.success).toBe(true);
    expect((result.data as any).config.locale).toEqual({ "Popup.Close": "Cerrar" });
    expect((result.data as any).chapters[0].description).toBe("1883-08-27");
  });
});

// Core's schemas are built on `zod/v3`, which zod 3.25 and zod 4 both ship.
// Next to Astro 4/5 (zod 3) a package manager usually installs ONE zod 3 for
// both, but it may install zod 4 for core beside the host's zod 3 -- as this
// workspace does (core: zod 4, astro/zod: zod 3). The two copies run each
// other's schemas; these pin that down.
describe("core schemas on a zod-3 host (Astro 4/5)", () => {
  const cases: unknown[] = [
    { center: [0, 0], zoom: 2, mapStyle: "https://x/style.json", extra: 1 },
    { center: [999, 0], zoom: 99 },
    { center: "x" },
    null,
  ];

  it("a core schema nested in a host z.object parses as core does", () => {
    const host = z.object({ title: z.string(), map: getSimpleMapSchema() });
    for (const value of cases) {
      const nested = host.safeParse({ title: "t", map: value });
      const own = MapConfigSchema.safeParse(value);
      expect(nested.success).toBe(own.success);
      if (nested.success && own.success) expect(nested.data.map).toEqual(own.data);
      if (!nested.success && !own.success) {
        expect(nested.error.issues).toEqual(own.error.issues.map((i) => ({ ...i, path: ["map", ...i.path] })));
      }
    }
  });

  it("extendSchema on a core schema keeps core's parsing and adds the host fields", () => {
    const schema = extendSchema(getSimpleMapSchema(), { featured: z.boolean().default(false) });
    for (const value of cases) {
      const extended = schema.safeParse(value);
      const own = MapConfigSchema.safeParse(value);
      expect(extended.success).toBe(own.success);
      if (extended.success && own.success) expect(extended.data).toEqual({ ...own.data, featured: false });
    }
  });
});
