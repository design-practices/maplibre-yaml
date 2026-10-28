/**
 * @file Tests for YAML loader utilities
 * @module @maplibre-yaml/astro/tests/utils/loader
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { readFileSync } from "fs";
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
import { YAMLParser as YAMLParserForGlob, parseDocumentText } from "@maplibre-yaml/core";
import type { MapBlock } from "@maplibre-yaml/core";

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
      expect(loadError.errors!.length).toBeGreaterThan(0);
      expect(loadError.filePath).toBe(yamlPath);
    }
  });
});

/**
 * ml-aot.4: the Astro dev overlay shows the entries of an `errors` array
 * (their `text`, framed at `location`), not the thrown message — and core's
 * ParseError messages carry no path or line. A student's typo'd key used to
 * read only "Expected array, got undefined" with no file, field or line.
 */
describe("validation errors name the file, field and line (ml-aot.4)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `astro-aot4-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const story = `type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
chapters:
  - id: a
    title: A
    center: [0, 0]
    zoom: 2
  - id: b
    title: B
    centre: [10, 10]
    zoom: 3
`;

  it("loadScrollytellingConfig: message, overlay text and location all carry path + line + did-you-mean", async () => {
    const yamlPath = join(testDir, "misspelled.yaml");
    await writeFile(yamlPath, story);

    const error = (await loadScrollytellingConfig(yamlPath).catch((e) => e)) as YAMLLoadError & {
      errors: Array<{ text: string; location?: { file: string; line: number } }>;
    };
    expect(error).toBeInstanceOf(YAMLLoadError);

    // The build log / top-level message.
    expect(error.message).toContain(yamlPath);
    // The typo itself is the error (core ml-okw), with its line; the
    // matching unknown-key warning is not repeated.
    expect(error.message).toMatch(
      /error +Chapter 2 \("b"\): Unknown key "centre" — did you mean "center"\? \("center" is required here\.\) \(line \d+/
    );
    // The message names the chapter, so the 0-based path is not repeated (ml-aot.62).
    expect(error.message).not.toMatch(/chapters\.1\.centre: Chapter 2/);
    expect(error.message).not.toMatch(/warning +chapters\.1\.centre/);

    // What Astro's dev overlay actually renders: the FIRST entry — its
    // `message` + `loc` on Astro 7 (Oxc shape), `text` + `location` on 4/5.
    const first = error.errors[0]! as any;
    for (const shown of [first.message, first.text]) {
      expect(shown).toContain(yamlPath);
      expect(shown).toMatch(
        /Chapter 2 \("b"\): Unknown key "centre" — did you mean "center"\? \("center" is required here\.\) \(line \d+, column \d+\)/
      );
      expect(shown).not.toContain("chapters.1.centre: ");
    }
    // ...framed at the YAML line of the typo.
    for (const where of [first.loc, first.location]) {
      expect(where?.file).toBe(yamlPath);
      expect(where?.line).toBeGreaterThanOrEqual(12);
    }

    // Programmatic consumers keep the structured fields and core's reason.
    expect(first.path).toBe("chapters.1.centre");
    expect(first.reason).toBe('Chapter 2 ("b"): Unknown key "centre" — did you mean "center"? ("center" is required here.)');
  });

  it("loadMapConfig gets the same treatment", async () => {
    const yamlPath = join(testDir, "map.yaml");
    await writeFile(
      yamlPath,
      `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: pts
    type: circle
    source:
      type: geojson
      url: "#cities.geojson"
`
    );
    const error = (await loadMapConfig(yamlPath).catch((e) => e)) as YAMLLoadError & {
      errors: Array<{ text: string }>;
    };
    expect(error.message).toContain(yamlPath);
    expect(error.message).toMatch(/layers\.0\.source\.url: Must be an absolute URL/);
    expect(error.errors[0]!.text).toMatch(/map\.yaml: layers\.0\.source\.url: Must be an absolute URL/);
    expect((error.errors[0] as any).message).toBe(error.errors[0]!.text);
  });

  it("loadFromGlob's aggregate names each file and field in the overlay text", async () => {
    const error = (await loadFromGlob(
      { "/src/stories/bad.yaml": () => story },
      (yaml) => YAMLParserForGlob.safeParseScrollytellingBlock(yaml)
    ).catch((e) => e)) as YAMLLoadError & { errors: Array<{ text: string }> };
    expect(error.errors[0]!.text).toContain("/src/stories/bad.yaml");
    expect(error.errors[0]!.text).toMatch(/bad\.yaml: Chapter 2 \("b"\): Unknown key "centre" — did you mean "center"\? .*\(line \d+/);
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

/**
 * Merge-key parity: this loader's own parse path.
 *
 * @remarks
 * `loadMapConfig` and `loadScrollytellingConfig` delegate to core's
 * `YAMLParser`, so they inherit core's options. `loadYAML` and `loadFromGlob`
 * call `yaml`'s `parse` directly and would otherwise have been left behind —
 * a merge-key document resolving correctly through `mlym validate` while
 * silently producing a literal `"<<"` key here. These tests are what keep the
 * loader's copy of the option in step with core's.
 */
describe("YAML-native reuse parity (U2)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `astro-merge-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const MERGE_DOC = `
defaults: &defaults
  color: "#111"
  weight: 2
primary:
  <<: *defaults
secondary:
  <<: *defaults
  color: "#222"
`;

  it("resolves merge keys through loadYAML", async () => {
    const yamlPath = join(testDir, "merge.yaml");
    await writeFile(yamlPath, MERGE_DOC);

    const result = await loadYAML<any>(yamlPath);

    expect(result.primary).toEqual({ color: "#111", weight: 2 });
    expect(result.secondary).toEqual({ color: "#222", weight: 2 });
    expect(Object.keys(result.primary)).not.toContain("<<");
  });

  it("resolves merge keys through loadFromGlob", async () => {
    const results = await loadFromGlob<any>({
      "virtual/merge.yaml": () => Promise.resolve(MERGE_DOC),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.config.secondary).toEqual({ color: "#222", weight: 2 });
    expect(Object.keys(results[0]!.config.secondary)).not.toContain("<<");
  });

  // The other half of the parse-options parity (ml-0fg): the loader's copy of
  // the options was missing the `!html` custom tag, so it silently dropped
  // `!html` to a bare string while core resolved it to `{ $html }`. These pin
  // that the loader now parses `!html` the way core's read path does.
  const HTML_DOC = `label: !html "<b>Bold</b>"\n`;

  it("resolves the !html tag through loadYAML (matching core)", async () => {
    const yamlPath = join(testDir, "html.yaml");
    await writeFile(yamlPath, HTML_DOC);

    const result = await loadYAML<any>(yamlPath);

    // Core resolves `!html "<b>Bold</b>"` to the structural marker, never a bare
    // string. A drifted copy missing the tag yields the string "<b>Bold</b>".
    expect(result.label).toEqual({ $html: "<b>Bold</b>" });
    expect(typeof result.label).not.toBe("string");
  });

  it("resolves the !html tag through loadFromGlob (matching core)", async () => {
    const results = await loadFromGlob<any>({
      "virtual/html.yaml": () => Promise.resolve(HTML_DOC),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.config.label).toEqual({ $html: "<b>Bold</b>" });
  });
});

/**
 * JSON and TOML documents (0.10, U7): every loader reads the format its
 * file's extension names, through core's `parseDocumentText`, so a TOML map
 * loads to the same config as its YAML twin and its errors carry TOML lines.
 */
describe("JSON and TOML documents", () => {
  const FIXTURES = join(__dirname, "../fixtures/documents");
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `astro-formats-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loadMapConfig: map.toml and map.json load to the same config as map.yaml", async () => {
    const yaml = await loadMapConfig(join(FIXTURES, "quick-start.yaml"));
    expect(await loadMapConfig(join(FIXTURES, "quick-start.toml"))).toEqual(yaml);
    expect(await loadMapConfig(join(FIXTURES, "quick-start.json"))).toEqual(yaml);
    expect(yaml.id).toBe("earthquake-map");
  });

  it("loadScrollytellingConfig: story.toml and story.json load to the same config as story.yaml", async () => {
    const yaml = await loadScrollytellingConfig(join(FIXTURES, "story.yaml"));
    expect(await loadScrollytellingConfig(join(FIXTURES, "story.json"))).toEqual(yaml);
    // TOML has no null: the story clears its filter by leaving `filter` out
    // (the same action at runtime), where the YAML writes `filter: null`.
    const exit = (yaml.chapters[1]!.onChapterExit as any[])[0];
    expect(exit).toMatchObject({ action: "setFilter", filter: null });
    delete exit.filter;
    expect(await loadScrollytellingConfig(join(FIXTURES, "story.toml"))).toEqual(yaml);
    expect(yaml.chapters.length).toBeGreaterThan(1);
  });

  it("a TOML locale, dotted or nested, loads to the YAML locale", async () => {
    const yaml = await loadMapConfig(join(FIXTURES, "locale.yaml"));
    expect(await loadMapConfig(join(FIXTURES, "locale.toml"))).toEqual(yaml);

    const nested = join(testDir, "nested.toml");
    await writeFile(
      nested,
      [
        'type = "map"',
        'id = "m"',
        "",
        "[config]",
        "center = [0, 0]",
        "zoom = 2",
        'mapStyle = "https://demotiles.maplibre.org/style.json"',
        "",
        "[config.locale]",
        '"Popup.Close" = "Cerrar"',
        "",
        "[config.locale.NavigationControl]",
        'ZoomIn = "Acercar"',
        "",
      ].join("\n")
    );
    const config = await loadMapConfig(nested);
    expect(config.config.locale).toEqual({ "Popup.Close": "Cerrar", "NavigationControl.ZoomIn": "Acercar" });
  });

  it("a TOML validation error names the file, field, TOML line and column in Astro's first-message display", async () => {
    const tomlPath = join(testDir, "map.toml");
    await writeFile(
      tomlPath,
      [
        'type = "map"', // 1
        'id = "m"', // 2
        "", // 3
        "[config]", // 4
        "center = [0, 0]", // 5
        "zoom = 2", // 6
        'mapStyle = "https://demotiles.maplibre.org/style.json"', // 7
        "", // 8
        "[[layers]]", // 9
        'id = "pts"', // 10
        'type = "circle"', // 11
        'source = { type = "geojson", url = "#cities.geojson" }', // 12
        "",
      ].join("\n")
    );
    const error = (await loadMapConfig(tomlPath).catch((e) => e)) as YAMLLoadError;
    expect(error).toBeInstanceOf(YAMLLoadError);
    expect(error.message).toContain(tomlPath);

    // What Astro's overlay renders: the first entry's message/text and loc/location.
    const first = error.errors![0]! as any;
    for (const shown of [first.message, first.text]) {
      expect(shown).toMatch(
        new RegExp(`^${tomlPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: layers\\.0\\.source\\.url: Must be an absolute URL.* \\(line 12, column \\d+\\)`)
      );
    }
    expect(first.loc).toMatchObject({ file: tomlPath, line: 12 });
    expect(first.location).toMatchObject({ file: tomlPath, line: 12 });
    expect(first.loc.column).toBeGreaterThan(1);
    expect(first.path).toBe("layers.0.source.url");
    expect(first.format).toBe("toml");
  });

  it("a TOML syntax error says TOML, with the file, line and column", async () => {
    const tomlPath = join(testDir, "broken.toml");
    await writeFile(tomlPath, 'type = "map"\nid = = "m"\n');
    const error = (await loadMapConfig(tomlPath).catch((e) => e)) as YAMLLoadError;
    expect(error).toBeInstanceOf(YAMLLoadError);
    const first = error.errors![0]! as any;
    expect(first.message).toMatch(/broken\.toml: TOML syntax error: .*\(line 2, column \d+\)/);
    expect(first.code).toBe("toml-syntax");
    expect(first.loc).toMatchObject({ file: tomlPath, line: 2 });
    expect(error.message).not.toMatch(/YAML syntax error/);
  });

  it("a JSON syntax error says JSON, not YAML", async () => {
    const jsonPath = join(testDir, "broken.json");
    await writeFile(jsonPath, '{\n  "type": "map",\n  "id": "m",,\n}\n');
    const error = (await loadMapConfig(jsonPath).catch((e) => e)) as YAMLLoadError;
    expect(error).toBeInstanceOf(YAMLLoadError);
    expect(error.errors![0]!.message).toMatch(/broken\.json: JSON syntax error: [\s\S]*\(line 3, column \d+\)/);
    expect(error.message).not.toMatch(/YAML syntax error/);

    const loaded = (await loadYAML(jsonPath).catch((e) => e)) as YAMLLoadError;
    expect(loaded).toBeInstanceOf(YAMLLoadError);
    expect(loaded.message).toMatch(/JSON syntax error/);
    expect(loaded.message).not.toMatch(/YAML syntax error/);
  });

  it("YAML text in a .toml file gets the relabel hint", async () => {
    const tomlPath = join(testDir, "mislabeled.toml");
    await writeFile(tomlPath, "type: map\nid: m\n");
    const error = (await loadMapConfig(tomlPath).catch((e) => e)) as YAMLLoadError;
    expect(error.errors![0]!.message).toMatch(/TOML syntax error/);
    expect(error.message).toMatch(/reads as YAML, not TOML/);
  });

  it("loadYAML reads any TOML or JSON data, not only documents", async () => {
    const tomlPath = join(testDir, "data.toml");
    await writeFile(tomlPath, 'title = "Test"\ncount = 3\nwhen = 2024-01-02\n\n[nested]\nitems = ["a", "b"]\n');
    expect(await loadYAML(tomlPath)).toEqual({
      title: "Test",
      count: 3,
      when: "2024-01-02",
      nested: { items: ["a", "b"] },
    });

    const jsonPath = join(testDir, "data.json");
    await writeFile(jsonPath, '{ "title": "Test", "count": 3 }');
    expect(await loadYAML(jsonPath, z.object({ title: z.string(), count: z.number() }))).toEqual({
      title: "Test",
      count: 3,
    });

    const emptyToml = join(testDir, "empty.toml");
    await writeFile(emptyToml, "# nothing yet\n");
    expect(await loadYAML(emptyToml)).toEqual({});
  });

  it("loadYAML: a TOML syntax error says TOML, with its line", async () => {
    const tomlPath = join(testDir, "bad.toml");
    await writeFile(tomlPath, 'title = "Test"\ncount = = 3\n');
    const error = (await loadYAML(tomlPath).catch((e) => e)) as YAMLLoadError;
    expect(error).toBeInstanceOf(YAMLLoadError);
    expect(error.message).toMatch(/TOML syntax error: .*\(line 2, column \d+\)/);
    expect(error.errors![0]!.message).toContain(tomlPath);
  });

  describe("loadFromGlob over mixed .yaml, .json and .toml", () => {
    const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
    const glob = () => ({
      "/src/maps/quick-start.yaml": () => Promise.resolve(read("quick-start.yaml")),
      "/src/maps/quick-start.json": () => Promise.resolve(read("quick-start.json")),
      "/src/maps/quick-start.toml": read("quick-start.toml"),
    });

    it("returns all three, as the same value, without a validator", async () => {
      const results = await loadFromGlob<any>(glob());
      expect(results.map((r) => r.path)).toEqual([
        "/src/maps/quick-start.yaml",
        "/src/maps/quick-start.json",
        "/src/maps/quick-start.toml",
      ]);
      // The authored documents (TOML's $schema directive is a comment).
      expect(results[1]!.config).toEqual(results[0]!.config);
      expect(results[2]!.config).toEqual(results[0]!.config);
    });

    it("validates all three with parseDocumentText, given each file's path and format", async () => {
      const seen: string[] = [];
      const results = await loadFromGlob(glob(), (text, { path, format }) => {
        seen.push(format);
        return parseDocumentText(text, { kind: "map", signals: { fileName: path } });
      });
      expect(seen).toEqual(["yaml", "json", "toml"]);
      expect(results).toHaveLength(3);
      expect(results[1]!.config).toEqual(results[0]!.config);
      expect(results[2]!.config).toEqual(results[0]!.config);
      expect((results[0]!.config as MapBlock).id).toBe("earthquake-map");
    });

    it("a TOML syntax error names the file and TOML line once in the aggregate", async () => {
      const error = (await loadFromGlob({
        ...glob(),
        "/src/maps/broken.toml": 'type = "map"\nid = = "m"\n',
      }).catch((e) => e)) as YAMLLoadError;
      expect(error).toBeInstanceOf(YAMLLoadError);
      const text = error.errors![0]!.text!;
      expect(text).toMatch(/^\/src\/maps\/broken\.toml: TOML syntax error: .*\(line 2, column \d+\)/);
      expect(text.split("broken.toml").length).toBe(2);
      expect(error.message).toMatch(/\/src\/maps\/broken\.toml:\n {2}TOML syntax error/);
    });
  });
});

/**
 * One reading path (U7): the loaders and core's front door must agree on
 * every document, including the YAML features a copy of the parse options
 * once dropped here (`!html`, ml-0fg) or would need (merge keys). If the
 * loader ever parses on its own again, these diverge.
 */
describe("loader and core's parseDocumentText agree (one reading path)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `astro-parity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const MAP = `
type: map
id: m
config: { center: [0, 0], zoom: 5, mapStyle: "https://demotiles.maplibre.org/style.json" }
x-base: &base
  circle-color: "#111"
  circle-radius: 4
sources:
  s: { type: geojson, data: { type: FeatureCollection, features: [] } }
layers:
  - id: a
    type: circle
    source: s
    paint:
      <<: *base
      circle-radius: 6
    interactive:
      click:
        popup:
          - p:
              - str: !html "<b>Bold</b>"
`;

  const TOML = `
type = "map"
id = "m"

[config]
center = [0, 0]
zoom = 5
mapStyle = "https://demotiles.maplibre.org/style.json"

[x-base]
circle-color = "#111"
circle-radius = 4

[sources.s]
type = "geojson"
data = { type = "FeatureCollection", features = [] }

[[layers]]
id = "a"
type = "circle"
source = "s"
paint = { circle-color = "#111", circle-radius = 6 }

[[layers.interactive.click.popup]]
p = [{ str = { "$html" = "<b>Bold</b>" } }]
`;

  it("loadMapConfig returns exactly what parseDocumentText validates, merge keys and !html included", async () => {
    const path = join(testDir, "map.yaml");
    await writeFile(path, MAP);
    const core = await parseDocumentText(MAP, { kind: "map", signals: { fileName: path } });
    expect(core.success).toBe(true);
    const loaded = await loadMapConfig(path);
    expect(loaded).toEqual(core.data);

    const layer = (loaded.layers as any[])[0];
    expect(layer.paint).toEqual({ "circle-color": "#111", "circle-radius": 6 });
    expect(layer.interactive.click.popup[0].p[0].str).toEqual({ $html: "<b>Bold</b>" });
  });

  it("loadYAML reads the same merge keys and !html as core does", async () => {
    const path = join(testDir, "map.yaml");
    await writeFile(path, MAP);
    const raw = await loadYAML<any>(path);
    const core = await parseDocumentText(MAP, { kind: "map", signals: { fileName: path } });
    expect(raw.layers[0].paint).toEqual((core.data as any).layers[0].paint);
    expect(raw.layers[0].interactive.click.popup[0].p[0].str).toEqual({ $html: "<b>Bold</b>" });
    expect(Object.keys(raw.layers[0].paint)).not.toContain("<<");
  });

  it("the TOML spelling ({\"$html\" = …}, the merge written out) loads to the same map", async () => {
    const yamlPath = join(testDir, "map.yaml");
    const tomlPath = join(testDir, "map.toml");
    await writeFile(yamlPath, MAP);
    await writeFile(tomlPath, TOML);
    const fromToml = await loadMapConfig(tomlPath);
    expect(fromToml).toEqual(await loadMapConfig(yamlPath));
    const core = await parseDocumentText(TOML, { kind: "map", signals: { fileName: tomlPath } });
    expect(fromToml).toEqual(core.data);
    // loadYAML's raw read of the TOML keeps the marker too.
    const raw = await loadYAML<any>(tomlPath);
    expect(raw.layers[0].interactive.click.popup[0].p[0].str).toEqual({ $html: "<b>Bold</b>" });
  });
});
