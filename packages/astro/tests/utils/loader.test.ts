/**
 * @file Tests for YAML loader utilities
 * @module @maplibre-yaml/astro/tests/utils/loader
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadYAML,
  loadMapConfig,
  loadScrollytellingConfig,
  loadFromGlob,
  YAMLLoadError,
} from "../../src/utils/loader";
import { z } from "zod";

describe("loadYAML", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = join(tmpdir(), `astro-loader-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads and parses valid YAML file", async () => {
    const yamlPath = join(testDir, "test.yaml");
    await writeFile(
      yamlPath,
      `
title: Test Config
count: 42
items:
  - one
  - two
  - three
`
    );

    const result = await loadYAML<{ title: string; count: number; items: string[] }>(yamlPath);

    expect(result).toEqual({
      title: "Test Config",
      count: 42,
      items: ["one", "two", "three"],
    });
  });

  it("validates with Zod schema", async () => {
    const yamlPath = join(testDir, "schema.yaml");
    await writeFile(
      yamlPath,
      `
title: Valid
count: 10
`
    );

    const schema = z.object({
      title: z.string(),
      count: z.number(),
    });

    const result = await loadYAML(yamlPath, schema);

    expect(result).toEqual({
      title: "Valid",
      count: 10,
    });
  });

  it("throws YAMLLoadError on YAML syntax error", async () => {
    const yamlPath = join(testDir, "bad-syntax.yaml");
    await writeFile(
      yamlPath,
      `
title: "Unclosed string
count: 42
`
    );

    await expect(loadYAML(yamlPath)).rejects.toThrow(YAMLLoadError);
    await expect(loadYAML(yamlPath)).rejects.toThrow(/YAML syntax error/);
  });

  it("throws YAMLLoadError on schema validation failure", async () => {
    const yamlPath = join(testDir, "invalid.yaml");
    await writeFile(
      yamlPath,
      `
title: "Valid"
count: "not a number"
`
    );

    const schema = z.object({
      title: z.string(),
      count: z.number(),
    });

    await expect(loadYAML(yamlPath, schema)).rejects.toThrow(YAMLLoadError);
  });

  it("throws YAMLLoadError on file not found", async () => {
    const nonExistentPath = join(testDir, "nonexistent.yaml");

    await expect(loadYAML(nonExistentPath)).rejects.toThrow(YAMLLoadError);
    await expect(loadYAML(nonExistentPath)).rejects.toThrow(/Failed to load/);
  });
});

describe("loadMapConfig", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `astro-map-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads valid map configuration", async () => {
    const yamlPath = join(testDir, "map.yaml");
    await writeFile(
      yamlPath,
      `
type: map
id: test-map
config:
  center: [-74.006, 40.7128]
  zoom: 12
  mapStyle: "https://demotiles.maplibre.org/style.json"
`
    );

    const result = await loadMapConfig(yamlPath);

    expect(result).toBeDefined();
    expect(result.type).toBe("map");
    expect(result.id).toBe("test-map");
    expect(result.config.center).toEqual([-74.006, 40.7128]);
    expect(result.config.zoom).toBe(12);
  });

  it("loads map with layers", async () => {
    const yamlPath = join(testDir, "map-with-layers.yaml");
    await writeFile(
      yamlPath,
      `
type: map
id: layered-map
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: points
    type: circle
    source:
      type: geojson
      data:
        type: FeatureCollection
        features: []
    paint:
      circle-radius: 5
      circle-color: "#ff0000"
`
    );

    const result = await loadMapConfig(yamlPath);

    expect(result.layers).toBeDefined();
    expect(result.layers).toHaveLength(1);
    expect(result.layers![0].id).toBe("points");
    expect(result.layers![0].type).toBe("circle");
  });

  it("throws on invalid map configuration", async () => {
    const yamlPath = join(testDir, "invalid-map.yaml");
    await writeFile(
      yamlPath,
      `
type: map
id: bad-map
config:
  center: [999, 40]  # Invalid longitude
  zoom: 50  # Invalid zoom
  mapStyle: "https://example.com/style.json"
`
    );

    await expect(loadMapConfig(yamlPath)).rejects.toThrow(YAMLLoadError);
    await expect(loadMapConfig(yamlPath)).rejects.toThrow(/validation failed/);
  });

  it("includes validation errors in YAMLLoadError", async () => {
    const yamlPath = join(testDir, "bad-config.yaml");
    await writeFile(
      yamlPath,
      `
type: map
id: test
config:
  center: [999, 0]
  zoom: 100
  mapStyle: "https://example.com/style.json"
`
    );

    try {
      await loadMapConfig(yamlPath);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(YAMLLoadError);
      const loadError = error as YAMLLoadError;
      expect(loadError.errors).toBeDefined();
      expect(loadError.errors.length).toBeGreaterThan(0);
      expect(loadError.filePath).toBe(yamlPath);
    }
  });
});

describe("loadScrollytellingConfig", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `astro-scrolly-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads valid scrollytelling configuration", async () => {
    const yamlPath = join(testDir, "story.yaml");
    await writeFile(
      yamlPath,
      `
type: scrollytelling
id: test-story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
  - id: chapter2
    title: "Chapter 2"
    center: [10, 10]
    zoom: 5
`
    );

    const result = await loadScrollytellingConfig(yamlPath);

    expect(result).toBeDefined();
    expect(result.type).toBe("scrollytelling");
    expect(result.id).toBe("test-story");
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe("Introduction");
    expect(result.chapters[1].title).toBe("Chapter 2");
  });

  it("loads scrollytelling with optional properties", async () => {
    const yamlPath = join(testDir, "full-story.yaml");
    await writeFile(
      yamlPath,
      `
type: scrollytelling
id: full-story
theme: dark
showMarkers: true
markerColor: "#ff0000"
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
chapters:
  - id: intro
    title: "Intro"
    center: [0, 0]
    zoom: 3
    description: "Welcome"
    alignment: left
    pitch: 45
footer: "<p>Data sources</p>"
`
    );

    const result = await loadScrollytellingConfig(yamlPath);

    expect(result.theme).toBe("dark");
    expect(result.showMarkers).toBe(true);
    expect(result.markerColor).toBe("#ff0000");
    expect(result.footer).toBe("<p>Data sources</p>");
    expect(result.chapters[0].description).toBe("Welcome");
    expect(result.chapters[0].alignment).toBe("left");
  });

  it("throws on empty chapters array", async () => {
    const yamlPath = join(testDir, "no-chapters.yaml");
    await writeFile(
      yamlPath,
      `
type: scrollytelling
id: no-chapters
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
chapters: []
`
    );

    await expect(loadScrollytellingConfig(yamlPath)).rejects.toThrow(YAMLLoadError);
  });

  it("throws on invalid chapter configuration", async () => {
    const yamlPath = join(testDir, "bad-chapter.yaml");
    await writeFile(
      yamlPath,
      `
type: scrollytelling
id: bad
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
chapters:
  - id: bad
    title: "Bad"
    center: [999, 0]  # Invalid
    zoom: 100  # Invalid
`
    );

    await expect(loadScrollytellingConfig(yamlPath)).rejects.toThrow(YAMLLoadError);
  });
});

describe("loadFromGlob", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `astro-glob-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads multiple YAML files", async () => {
    await writeFile(join(testDir, "one.yaml"), "title: One\ncount: 1");
    await writeFile(join(testDir, "two.yaml"), "title: Two\ncount: 2");
    await writeFile(join(testDir, "three.yaml"), "title: Three\ncount: 3");

    const globResult = {
      [join(testDir, "one.yaml")]: "title: One\ncount: 1",
      [join(testDir, "two.yaml")]: "title: Two\ncount: 2",
      [join(testDir, "three.yaml")]: "title: Three\ncount: 3",
    };

    const results = await loadFromGlob(globResult);

    expect(results).toHaveLength(3);
    expect(results[0].config).toEqual({ title: "One", count: 1 });
    expect(results[1].config).toEqual({ title: "Two", count: 2 });
    expect(results[2].config).toEqual({ title: "Three", count: 3 });
  });

  it("loads with validator function", async () => {
    const globResult = {
      "map1.yaml": `
type: map
id: map1
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
`,
      "map2.yaml": `
type: map
id: map2
config:
  center: [10, 10]
  zoom: 4
  mapStyle: "https://demotiles.maplibre.org/style.json"
`,
    };

    const { YAMLParser } = await import("@maplibre-yaml/core");
    const results = await loadFromGlob(globResult, (yaml) => YAMLParser.safeParseMapBlock(yaml));

    expect(results).toHaveLength(2);
    expect(results[0].config.id).toBe("map1");
    expect(results[1].config.id).toBe("map2");
  });

  it("throws when validation fails", async () => {
    const globResult = {
      "good.yaml": `
type: map
id: good
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
`,
      "bad.yaml": `
type: map
id: bad
config:
  center: [999, 0]
  zoom: 100
  mapStyle: "https://demotiles.maplibre.org/style.json"
`,
    };

    const { YAMLParser } = await import("@maplibre-yaml/core");

    await expect(
      loadFromGlob(globResult, (yaml) => YAMLParser.safeParseMapBlock(yaml))
    ).rejects.toThrow(YAMLLoadError);
  });

  it("handles async glob loaders", async () => {
    const globResult = {
      "async1.yaml": async () => "title: Async One\ncount: 1",
      "async2.yaml": async () => "title: Async Two\ncount: 2",
    };

    const results = await loadFromGlob(globResult);

    expect(results).toHaveLength(2);
    expect(results[0].config).toEqual({ title: "Async One", count: 1 });
    expect(results[1].config).toEqual({ title: "Async Two", count: 2 });
  });

  it("throws YAMLLoadError when files have syntax errors", async () => {
    const globResult = {
      "bad1.yaml": "title: 'unclosed string\ncount: 42",
      "bad2.yaml": "count: {\n  invalid: [",
    };

    await expect(loadFromGlob(globResult)).rejects.toThrow(YAMLLoadError);
  });
});
